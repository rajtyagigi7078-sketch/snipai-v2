const fs=require('fs'),path=require('path');
async function main(){const {build}=await import('vite');const folder=path.resolve('.build/store-styles');fs.mkdirSync(folder,{recursive:true});
 await build({configFile:false,base:'./',build:{outDir:folder,emptyOutDir:false,lib:{entry:path.resolve('scripts/store-typography-previews.ts'),name:'StylePreviews',formats:['iife'],fileName:()=> 'previews.js'}}});
 fs.mkdirSync(path.join(folder,'assets'),{recursive:true});fs.cpSync('public/assets/capsnip-typography',path.join(folder,'assets/capsnip-typography'),{recursive:true});
 fs.writeFileSync(path.join(folder,'index.html'),'<!doctype html><html><body><script src="previews.js"></script></body></html>');
}main().catch(e=>{console.error(e);process.exitCode=1});
