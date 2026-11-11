'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {measureText}=require('./font-metrics.cjs');
const root=path.resolve(__dirname,'..');
const unpackedRoot=root.replace(/app\.asar$/, 'app.asar.unpacked');
const assets=[path.join(unpackedRoot,'dist/assets/capsnip-typography'),path.join(root,'dist/assets/capsnip-typography'),path.join(root,'public/assets/capsnip-typography')].find(dir=>fs.existsSync(path.join(dir,'catalog.json')));
const catalog=assets?JSON.parse(fs.readFileSync(path.join(assets,'catalog.json'),'utf8')):[];
const layouts=[['left','right'],['left','center'],['left','left'],['center','right'],['right','left'],['left','right'],['left','center'],['center','left'],['right','center'],['left','right'],['center','right'],['left','left'],['right','right'],['left','center'],['center','left']];
function escape(value){return String(value).replace(/\\/g,'\\\\').replace(/'/g,"'\\''").replace(/:/g,'\\:').replace(/%/g,'\\%').replace(/,/g,'\\,').replace(/\[/g,'\\[').replace(/\]/g,'\\]').replace(/;/g,'\\;').replace(/\n/g,' ')}
function n(value,fallback){const v=Number(value);return Number.isFinite(v)?v:fallback}
function normalized(position,fallback){const p=position||fallback;return{x:Math.max(.01,Math.min(.99,n(p?.x,.5)/(n(p?.x,.5)>1?100:1))),y:Math.max(.01,Math.min(.99,n(p?.y,.72)/(n(p?.y,.72)>1?100:1)))}}
function buildCaptionFilter(words,options={}){
  const theme=catalog.find(t=>t.key===options.template||t.id===options.template||t.name===options.template);if(!theme)throw new Error(`Unknown Capsnip typography theme: ${options.template}`);
  const width=n(options.width,1080),height=n(options.height,1920),scale=n(options.captionScale,n(options.fontScale,1)),baseSize=Math.round(height*n(options.fontSize,theme.size)/1080*scale);
  const fontFile=options.fontFile||path.join(assets,theme.fontFile);if(!fs.existsSync(fontFile))throw new Error(`Typography font is missing: ${fontFile}`);
  const data=words.filter(w=>String(w.text||w.word||'').trim()).map(w=>({...w,text:String(w.text||w.word).trim(),start:n(w.start,0),end:n(w.end,n(w.start,0)+.2)})).sort((a,b)=>a.start-b.start);
  const segments=[];let segment=[];
  for(const word of data){const prev=segment.at(-1),explicit=word.segmentIndex??word.lineIndex,prevExplicit=prev?.segmentIndex??prev?.lineIndex;if(segment.length&&(explicit!==undefined?explicit!==prevExplicit:segment.length>=5||word.start-prev.end>.38)){segments.push(segment);segment=[]}segment.push(word)}if(segment.length)segments.push(segment);
  const filters=[];
  segments.forEach((segment,cueIndex)=>{
    for(let first=0;first<segment.length;first+=3){
      const group=segment.slice(first,first+3),groupEnd=segment[first+3]?.start??segment.at(-1).end,layout=layouts[(cueIndex+Math.floor(first/3))%layouts.length];
      const textFor=text=>theme.casing==='upper'?text.toLocaleUpperCase():theme.casing==='lower'?text.toLocaleLowerCase():text;
      const middleWidth=Math.min(width*.86,measureText(textFor(group[1]?.text||group[0].text),baseSize,null,fontFile)*1.48);
      group.forEach((word,index)=>{
        const slot=index%3,tier=[.48,1.48,.48][slot],wordWidth=measureText(textFor(word.text),baseSize,null,fontFile)*tier,fit=Math.min(1,width*.86/Math.max(1,wordWidth));
        const position=normalized(word.position||options.linePositions?.[String(cueIndex)],options.globalCaptionPosition||options.captionPosition||{x:options.horizontalPosition??.5,y:options.verticalPosition??.72});
        let centerX=width*position.x;const align=slot===0?layout[0]:slot===2?layout[1]:'center';if(align==='left')centerX=centerX-middleWidth/2+wordWidth*fit/2;else if(align==='right')centerX=centerX+middleWidth/2-wordWidth*fit/2;centerX=Math.max(wordWidth*fit/2+2,Math.min(width-wordWidth*fit/2-2,centerX));
        const nextStart=group[index+1]?.start??groupEnd,start=word.start.toFixed(4),end=groupEnd.toFixed(4),activeEnd=nextStart.toFixed(4),progress=`min(1\\,max(0\\,(t-${start})/.14))`,ease=`(1-pow(1-${progress}\\,3))`,intro=`if(lt(t\\,${activeEnd})\\,.96+.04*${ease}\\,1)`;
        const fontSize=baseSize*tier*fit,centerY=height*position.y+baseSize*[-1.16,0,1.16][slot],y=`${centerY.toFixed(3)}-text_h/2+if(lt(t\\,${activeEnd})\\,(1-${ease})*${(baseSize*.08).toFixed(3)}\\,0)`,alpha=`if(lt(t\\,${activeEnd})\\,${ease}\\,.96)`,color=slot===1?(options.accentColor||theme.accent):(options.primaryColor||theme.baseColor);
        filters.push(`drawtext=fontfile='${escape(fontFile.replace(/\\/g,'/'))}':text='${escape(textFor(word.text))}':expansion=none:fix_bounds=true:fontsize='${fontSize.toFixed(3)}*${intro}':fontcolor=${String(color).replace('#','0x')}:x='${centerX.toFixed(3)}-text_w/2':y='${y}':alpha='${alpha}':enable='gte(t\\,${start})*lt(t\\,${end})':shadowcolor=black@0.55:shadowx=0:shadowy=${Math.max(1,Math.round(baseSize*.04))}`);
      });
    }
  });
  return{filter:filters.length?filters.join(','):'null',wordCount:data.length,lineCount:segments.length};
}
module.exports={buildCaptionFilter,catalog};
