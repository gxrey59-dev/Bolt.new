import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
await db.exec(await readFile(new URL('../supabase/migrations/20261111195226_subscription_checkout_claims.sql', import.meta.url), 'utf8'));
const user = '00000000-0000-4000-8000-000000000001';
const firstParams = { customer:'cus_shared', mode:'subscription', success_url:'https://app.example/first', integration_identifier:'app-abcdefgh', expires_at:123456, line_items:[{quantity:1,price:'price_pro'}] };
const secondParams = { ...firstParams,success_url:'https://app.example/second',integration_identifier:'app-ijklmnop',expires_at:123459 };
let attempt;
const claim = async params => (await db.query("SELECT claim_subscription_checkout($1,'pro',$2::jsonb) AS attempt", [user,JSON.stringify(params)])).rows[0].attempt;

test('competing tabs share a single durable attempt and immutable Stripe parameters', async () => {
  const results = await Promise.all([claim(firstParams),claim(secondParams)]);
  assert.equal(results[0].attempt_id, results[1].attempt_id);
  assert.deepEqual(results[0].checkout_params,results[1].checkout_params);
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM subscription_checkout_attempts')).rows[0].n,1);
  attempt=results[0];
});

test('unknown Stripe outcome cannot be released, even when the attempt is old', async () => {
  await db.query("UPDATE subscription_checkout_attempts SET created_at=now()-interval '3 days'");
  const released=(await db.query("SELECT release_subscription_checkout($1,'pro',$2,NULL) AS released",[user,attempt.attempt_id])).rows[0].released;
  assert.equal(released,false);
  const retry=await claim(secondParams);
  assert.equal(retry.attempt_id,attempt.attempt_id);
  assert.deepEqual(retry.checkout_params,attempt.checkout_params);
});

test('session attachment is idempotent and cannot overwrite a different session', async () => {
  const attach = async session => (await db.query("SELECT attach_subscription_checkout($1,'pro',$2,$3) AS attached",[user,attempt.attempt_id,session])).rows[0].attached;
  assert.equal(await attach('cs_one'),true);
  assert.equal(await attach('cs_one'),true);
  assert.equal(await attach('cs_other'),false);
  assert.equal((await claim(secondParams)).stripe_session_id,'cs_one');
});

test('only the exact known attempt/session pair can release a slot for another checkout', async () => {
  const release=async session=>(await db.query("SELECT release_subscription_checkout($1,'pro',$2,$3) AS released",[user,attempt.attempt_id,session])).rows[0].released;
  assert.equal(await release('cs_other'),false);
  assert.equal(await release('cs_one'),true);
  const next=await claim(secondParams);
  assert.notEqual(next.attempt_id,attempt.attempt_id);
  assert.deepEqual(next.checkout_params,secondParams);
  // A late response to the old attempt cannot attach itself to the new one.
  const late=(await db.query("SELECT attach_subscription_checkout($1,'pro',$2,'cs_one') AS attached",[user,attempt.attempt_id])).rows[0].attached;
  assert.equal(late,false);
});

test('checkout claims and payment parameters are not accessible to client roles', async () => {
  const {rows}=await db.query("SELECT has_function_privilege('anon','claim_subscription_checkout(uuid,text,jsonb)','EXECUTE') AS anon,has_function_privilege('authenticated','release_subscription_checkout(uuid,text,uuid,text)','EXECUTE') AS authenticated,has_table_privilege('authenticated','subscription_checkout_attempts','SELECT') AS read,has_function_privilege('service_role','claim_subscription_checkout(uuid,text,jsonb)','EXECUTE') AS service");
  assert.deepEqual(rows[0],{anon:false,authenticated:false,read:false,service:true});
});

test.after(async()=>{await db.close();});
