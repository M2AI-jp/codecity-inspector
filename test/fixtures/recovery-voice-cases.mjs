import {detectRecovery} from '../../src/facilities/recovery.mjs';
export const recoveryCommands = ['wrangler rollback','vercel rollback','kubectl rollout undo','helm rollback','fly releases rollback','heroku rollback','firebase hosting:rollback','aws rollback','gcloud deploy --to-revision old','deploy git revert','flyctl deploy --image previous','migrate down','prisma migrate resolve --rolled-back','knex migrate:rollback','rails db:rollback','pg_dump db\npg_restore db'];
export function recoveryFacts() {
 const texts=new Map(recoveryCommands.map((s,i)=>[`scripts/step-${i}.sh`,s]));
 for(const [path,text] of [['docs/recovery.md','# Recovery\n'],['docs/operations.md','# 復旧\n'],['scripts/backup.sh','echo backup'],['scripts/rollback.sh','echo rollback'],['migrations/1.down.sql','DROP TABLE example;']])texts.set(path,text);
 const combined={deployment:[],database:[],backup:[],runbook:[]};
 for(const [path,text] of texts){
  const found=detectRecovery({files:[{path,bytes:text.length,ext:path.split('.').at(-1),binary:false}],workflows:[],chosen:[],read:paths=>new Map(paths.map(p=>[p,texts.get(p)]))});
  for(const [kind,hits] of Object.entries(found?.facts||{}))combined[kind].push(...hits);
 }
 return combined;
}
