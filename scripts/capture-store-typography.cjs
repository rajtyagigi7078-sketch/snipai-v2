const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path');
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:900,height:650});await win.loadFile(path.resolve('.build/store-styles/index.html'));
 let previews;for(let i=0;i<100;i++){previews=await win.webContents.executeJavaScript('window.stylePreviews');if(previews)break;await new Promise(r=>setTimeout(r,100));}
 if(!previews || previews.length!==10)throw Error('Missing typography examples');
 for(const item of previews)fs.writeFileSync('snip-store/assets/style-'+item.id+'.png',Buffer.from(item.image.split(',')[1],'base64'));
 fs.writeFileSync('.build/store-styles/catalog.json',JSON.stringify(previews.map(({image,...item})=>item),null,2));console.log('10 canonical style images saved');win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
