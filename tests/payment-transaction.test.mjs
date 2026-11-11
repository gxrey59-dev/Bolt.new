import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const schema = `
CREATE TABLE public.paper_trades(id uuid PRIMARY KEY);
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.nft_collection(id uuid PRIMARY KEY, mint_price numeric NOT NULL, minted_count integer NOT NULL, total_supply integer NOT NULL);
CREATE TABLE public.nft_sales(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nft_id uuid NOT NULL REFERENCES nft_collection(id),buyer_user_id uuid,buyer_email text NOT NULL,stripe_checkout_session_id text UNIQUE NOT NULL,stripe_payment_intent_id text,amount_total bigint NOT NULL,currency text NOT NULL,status text NOT NULL CHECK(status IN ('pending','completed','canceled')),created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.stripe_orders(id bigint GENERATED ALWAYS AS IDENTITY,checkout_session_id text NOT NULL,payment_intent_id text NOT NULL,customer_id text NOT NULL,amount_subtotal bigint NOT NULL,amount_total bigint NOT NULL,currency text NOT NULL,payment_status text NOT NULL,status text NOT NULL);
`;
const card = '00000000-0000-4000-8000-000000000001';
const db = new PGlite();
await db.exec(schema);
await db.exec(await readFile(new URL('../supabase/migrations/20261111195055_revenue_reliability.sql', import.meta.url), 'utf8'));
await db.query('INSERT INTO nft_collection VALUES($1,29,0,1)', [card]);

let reservation;
test('last collection item can only be reserved once', async () => {
  const {rows} = await db.query('SELECT reserve_nft_checkout($1,NULL,$2) AS sale', [card,'buyer@example.com']);
  reservation = rows[0].sale.id;
  await assert.rejects(db.query('SELECT reserve_nft_checkout($1,NULL,$2)',[card,'other@example.com']), /Sold out/);
});

test('mismatched paid amount rolls back fulfillment completely', async () => {
  await assert.rejects(db.query('SELECT fulfill_nft_checkout($1,$2,$3,$4,$5,$6,$6,$7,$8)', ['cs_paid',reservation,card,'pi_paid','cus_buyer',1,'usd','buyer@example.com']), /does not match/);
  assert.equal((await db.query('SELECT minted_count FROM nft_collection')).rows[0].minted_count,0);
  assert.equal((await db.query('SELECT status FROM nft_sales')).rows[0].status,'pending');
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM stripe_orders')).rows[0].n,0);
});

test('repeated payment delivery records exactly one sale, order, and stock increment', async () => {
  const args=['cs_paid',reservation,card,'pi_paid','cus_buyer',2900,'usd','buyer@example.com'];
  const q='SELECT fulfill_nft_checkout($1,$2,$3,$4,$5,$6,$6,$7,$8) AS applied';
  assert.equal((await db.query(q,args)).rows[0].applied,true);
  assert.equal((await db.query(q,args)).rows[0].applied,false);
  assert.equal((await db.query('SELECT minted_count FROM nft_collection')).rows[0].minted_count,1);
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM stripe_orders')).rows[0].n,1);
  assert.equal((await db.query('SELECT status FROM nft_sales')).rows[0].status,'completed');
});

test('a reservation cannot be fulfilled under another Stripe checkout session', async () => {
  await assert.rejects(db.query('SELECT fulfill_nft_checkout($1,$2,$3,$4,$5,$6,$6,$7,$8)', ['cs_other',reservation,card,'pi_other','cus_buyer',2900,'usd','buyer@example.com']), /another payment/);
});

test('anonymous and authenticated users cannot invoke privileged checkout RPCs', async () => {
  const {rows}=await db.query("SELECT has_function_privilege('anon','reserve_nft_checkout(uuid,uuid,text)','EXECUTE') AS anon,has_function_privilege('authenticated','fulfill_nft_checkout(text,uuid,uuid,text,text,bigint,bigint,text,text)','EXECUTE') AS authenticated,has_function_privilege('service_role','reserve_nft_checkout(uuid,uuid,text)','EXECUTE') AS service");
  assert.deepEqual(rows[0],{anon:false,authenticated:false,service:true});
});

test('billing risk events are durable and duplicate delivery is harmless', async () => {
  const q="SELECT record_billing_review_event('evt_risk','charge.dispute.created','ch_1','cus_buyer',100)";
  await db.query(q); await db.query(q);
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM billing_review_events')).rows[0].n,1);
});

test('an order write failure rolls back the paid sale and inventory increment', async () => {
  const second = '00000000-0000-4000-8000-000000000002';
  await db.query('INSERT INTO nft_collection VALUES($1,29,0,1)',[second]);
  const sale = (await db.query('SELECT reserve_nft_checkout($1,NULL,$2) AS sale',[second,'buyer@example.com'])).rows[0].sale;
  await db.exec("ALTER TABLE stripe_orders ADD CONSTRAINT reject_test_customer CHECK(customer_id <> 'cus_fail')");
  await assert.rejects(db.query('SELECT fulfill_nft_checkout($1,$2,$3,$4,$5,$6,$6,$7,$8)', ['cs_fail',sale.id,second,'pi_fail','cus_fail',2900,'usd','buyer@example.com']), /reject_test_customer/);
  assert.equal((await db.query('SELECT minted_count FROM nft_collection WHERE id=$1',[second])).rows[0].minted_count,0);
  assert.equal((await db.query('SELECT status FROM nft_sales WHERE id=$1',[sale.id])).rows[0].status,'pending');
});

test.after(async () => { await db.close(); });
