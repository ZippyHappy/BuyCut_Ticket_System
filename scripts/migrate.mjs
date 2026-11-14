import 'dotenv/config';
import { readdir,readFile } from 'node:fs/promises';
import pg from 'pg';
const {Pool}=pg;
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true}:undefined});
const client=await pool.connect();
try {
 await client.query('SELECT pg_advisory_lock(78123041)');
 await client.query('CREATE TABLE IF NOT EXISTS buycut_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
 const dir=new URL('../migrations/',import.meta.url);
 const files=(await readdir(dir)).filter(x=>/^\d+_.+\.sql$/.test(x)).sort();
 for(const name of files){
  await client.query('BEGIN');
  try {
   const done=await client.query('SELECT 1 FROM buycut_migrations WHERE name=$1',[name]);
   if(!done.rowCount){await client.query(await readFile(new URL(name,dir),'utf8'));await client.query('INSERT INTO buycut_migrations(name) VALUES($1)',[name]);console.log(`Applied ${name}`)}
   await client.query('COMMIT');
  } catch(error){await client.query('ROLLBACK');throw error}
 }
} finally {
 await client.query('SELECT pg_advisory_unlock(78123041)').catch(()=>{});
 client.release();
 await pool.end();
}


