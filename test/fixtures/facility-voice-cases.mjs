// Branch samples for every facility voice. Also used to write out all spoken sentences.
const commit = {subject:'試験を追加する',date:'2026-11-17T00:00:00Z',author:'旅人'};
const record = {tool:'node --test',mtime:'2026-11-18T00:00:00Z',failures:2};
const populated = {
 town_hall:{commits:12,contributors:3,contributorsWindow:5000,firstCommit:'2026-10-01',lastCommit:'2026-11-17',tags:2,latestTag:{name:'v1'},dirty:3,agents:[{name:'Codex',commits:2},{name:'Claude Code',commits:4},{name:'Aider',commits:1}],changelog:'CHANGELOG.md'},
 inn:{servers:[{path:'server.js',how:'HTTPサーバーの呼び出し'}],domains:['example.test'],deploy:['deploy.yml'],frameworks:['Next.js'],configs:['next.config.js'],pages:['app/page.js']},
 pub:{connectors:[{name:'OpenAI',via:'dep',paths:['package.json']},{name:'Slack',via:'dep',paths:['package.json']},{name:'GitHub',via:'url',paths:['src/client.js']}],webhooks:['/api/hook']},
 warehouse:{kinds:['SQLite'],sqlFiles:2,migrations:3,configs:['database.yml'],dataFiles:['data.db'],sqliteCode:['db.js']},
 watchtower:{tools:['Sentry'],logDirs:['logs/'],configs:['sentry.config.js']},
 dojo:{state:'failed',latestRecord:record,files:5,runners:['Vitest','node --test'],dirs:['test/','e2e/'],latest:commit},
 repair:{deployment:[{path:'deploy.sh',detail:'「wrangler rollback」'}],database:[{path:'migrations/1.down.sql',detail:'down migration'}],backup:[{path:'restore.sh',detail:'「pg_dump」と「pg_restore」の両方がある'}],runbook:[{path:'docs/recovery.md',detail:'ファイル名に「recovery」がある'}]},
 well:{names:['TOKEN','DATABASE_URL','PORT','API_KEY'],namesTotal:5,examples:['.env.example'],committed:['.env'],loaders:['dotenv'],ciSecrets:['NPM_TOKEN','TOKEN'],configs:['config.json']},
 gate:{domains:['example.test'],deploy:[{path:'vercel.json',name:'Vercel'}],servers:[{path:'server.js',how:'HTTPサーバーの呼び出し'}],frameworks:['Next.js'],routes:[{route:'/api/a'},{route:'/api/b'}],routesTotal:3,auth:[{name:'NextAuth.js'}]},
 dock:{apps:[{kind:'iOS',path:'.'},{kind:'Android',path:'android/'}],packages:[{name:'app',version:'1.2',path:'package.json'},{name:'core',path:'core/package.json'}],bins:['app'],publish:['release.yml']},
};
export const facilityVoiceCases=[];
for(const [archetype,facts] of Object.entries(populated)){
 const add=(name,f,town={buildings:[{facility:{archetype:'dojo'}}],canal:{past:['src/server']}})=>facilityVoiceCases.push({name:`${archetype}/${name}`,archetype,facts:f,town});
 add('empty',{});add('populated',facts);add('without-dojo-canal',facts,{});
 for(const key of Object.keys(facts)){
  const without={...facts};delete without[key];add(`without-${key}`,without);
  if(Array.isArray(facts[key]))add(`one-${key}`,{...facts,[key]:facts[key].slice(0,1)});
 }
 if(archetype==='town_hall')for(const f of [{shallow:true},{contributorsWindow:null},{tags:0},{tags:null},{firstCommit:facts.lastCommit}])add(JSON.stringify(f),{...facts,...f});
 if(archetype==='dojo')for(const state of ['passed','failed','unverified'])for(const latestRecord of [record,null,{tool:null,mtime:null,failures:0}])add(`${state}/${JSON.stringify(latestRecord)}`,{...facts,state,latestRecord});
 if(archetype==='inn')add('config-and-deploy',{...facts,frameworks:[],domains:[]});
 if(archetype==='pub')add('many-connectors',{connectors:['a','b','c','d','e'].map(name=>({name,via:'dep',paths:['package.json']}))});
 if(archetype==='well')for(const names of [['A'],['A','B','C']])add(`names-${names.length}`,{...facts,names,namesTotal:names.length,examples:[]});
 if(archetype==='gate')for(const f of [{domains:[],deploy:[],servers:[]},{deploy:[{path:'deploy.json'}],routes:[{route:'/api'}],routesTotal:1,auth:[]},{domains:[],servers:[],routes:[],auth:[]}])add(JSON.stringify(f),{...facts,...f});
 if(archetype==='dock')for(const kind of ['iOS','macOS','Apple','Android','Expo','React Native','Electron','Tauri','Capacitor','Flutter','Browser extension','VS Code extension','Unknown'])add(`app-${kind}`,{apps:[{kind,path:'app/'}]});
}
