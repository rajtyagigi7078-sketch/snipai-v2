import catalog from "./capsnipCatalog.json";

export type TypographyWord = { text: string; start: number; end: number };
export type TypographySegment = { text: string; start: number; end: number; words?: TypographyWord[] };
export const CAPSNIP_TYPOGRAPHY_CATALOG = catalog;
export const CAPSNIP_TYPOGRAPHY_THEMES = catalog.map(theme => ({
  name: theme.key, label: theme.name,
  description: `${theme.typographyCategory} · ${theme.font.split(",")[0]}`,
}));
const layouts = [
  {top:"left",bottom:"right"},{top:"left",bottom:"center"},{top:"left",bottom:"left"},
  {top:"center",bottom:"right"},{top:"right",bottom:"left"},{top:"left",bottom:"right"},
  {top:"left",bottom:"center"},{top:"center",bottom:"left"},{top:"right",bottom:"center"},
  {top:"left",bottom:"right"},{top:"center",bottom:"right"},{top:"left",bottom:"left"},
  {top:"right",bottom:"right"},{top:"left",bottom:"center"},{top:"center",bottom:"left"},
];
let fontPromise: Promise<void> | undefined;
export function loadCapsnipTypographyFonts() {
  if (fontPromise) return fontPromise;
  fontPromise = Promise.all(catalog.map(async theme => {
    const family = theme.font.split(",")[0].trim();
    const url = `${import.meta.env.BASE_URL}assets/capsnip-typography/${theme.fontFile}`;
    const face = new FontFace(family, `url("${url}")`, { weight: theme.fontWeightRange, style: theme.fontStyle });
    await face.load(); document.fonts.add(face);
  })).then(() => undefined);
  return fontPromise;
}

export function typographyTheme(id: string) { return catalog.find(theme => theme.key === id || theme.id === id || theme.name === id); }

/** Same top/middle/bottom renderer as Capsnip, with percentage-normalized anchors. */
export function drawCapsnipCaption(
  ctx: CanvasRenderingContext2D, segment: TypographySegment, time: number, width: number, height: number,
  themeId: string, position = {x: .5, y: .72}, scaleFactor = 1, cueIndex = 0,
  overrides: { color?: string; accentColor?: string; fontSize?: number } = {},
) {
  const theme = typographyTheme(themeId); if (!theme) return;
  const source = segment.words?.length ? segment.words : segment.text.trim().split(/\s+/).filter(Boolean).map((text,index,array) => ({text,start:segment.start+index*(segment.end-segment.start)/array.length,end:segment.start+(index+1)*(segment.end-segment.start)/array.length}));
  if (!source.length) return;
  let activeIndex = source.findIndex(word => time >= word.start && time <= word.end);
  if (activeIndex < 0) { activeIndex = -1; for (let i=0;i<source.length;i++) { if(source[i].start<=time)activeIndex=i;else break; } }
  if (activeIndex < 0 || time > segment.end) return;
  const fontSize = Math.round(height * ((overrides.fontSize || theme.size) / 1080) * scaleFactor);
  const first=Math.floor(activeIndex/3)*3, visible=source.slice(first,activeIndex+1), centerX=width*position.x, centerY=height*position.y, maxWidth=width*.86;
  const activeWord=source[activeIndex],progress=Math.max(0,Math.min(1,(time-activeWord.start)/.14)),ease=1-Math.pow(1-progress,3),tierScale=[.48,1.48,.48],tierY=[-1.16,0,1.16];
  const layout=layouts[((cueIndex+Math.floor(first/3))%layouts.length+layouts.length)%layouts.length],group=source.slice(first,first+3),middleText=group[1]?.text||group[0]?.text||"";
  const textFor=(text:string)=>theme.casing==="upper"?text.toLocaleUpperCase():theme.casing==="lower"?text.toLocaleLowerCase():text;
  ctx.save();ctx.font=`${theme.italic?"italic ":""}${theme.weight} ${fontSize}px ${theme.font}`;ctx.textAlign="center";ctx.textBaseline="middle";ctx.lineJoin="round";ctx.shadowColor="rgba(0,0,0,.55)";ctx.shadowBlur=Math.max(2,fontSize*.09);ctx.shadowOffsetX=0;ctx.shadowOffsetY=Math.max(1,fontSize*.04);
  const middleWidth=Math.min(maxWidth,ctx.measureText(textFor(middleText)).width*tierScale[1]);
  visible.forEach((word,index)=>{
    const slot=index%3,isActive=index===visible.length-1,scale=tierScale[slot],text=textFor(word.text),measure=ctx.measureText(text).width,fitScale=Math.min(1,maxWidth/Math.max(1,measure*scale)),renderedWidth=measure*scale*fitScale,align=slot===0?layout.top:slot===2?layout.bottom:"center";
    let x=centerX;if(align==="left")x=centerX-middleWidth/2+renderedWidth/2;else if(align==="right")x=centerX+middleWidth/2-renderedWidth/2;
    x=Math.max(renderedWidth/2+2,Math.min(width-renderedWidth/2-2,x));const y=centerY+fontSize*tierY[slot]+(isActive?(1-ease)*fontSize*.08:0);
    ctx.globalAlpha=isActive?ease:.96;ctx.fillStyle=slot===1?(overrides.accentColor||theme.accent):(overrides.color||theme.baseColor);ctx.save();ctx.translate(x,y);ctx.scale(fitScale*scale*(isActive?.96+.04*ease:1),scale*(isActive?.96+.04*ease:1));ctx.fillText(text,0,0);ctx.restore();
  });ctx.restore();ctx.globalAlpha=1;
}

/** Capsnip's preview sample, pattern loop, and responsive rendering-scale calculation. */
export function paintCapsnipTemplateSample(canvas: HTMLCanvasElement, themeId: string, elapsed: number) {
  const theme=typographyTheme(themeId),ctx=canvas.getContext("2d");if(!theme||!ctx)return;
  const sampleWords=theme.sample.trim().split(/\s+/),period=2.6,time=elapsed%period,sequence=theme.pattern.sequence,patternCueIndex=Math.floor(elapsed/period)%sequence.length,cue=sequence[patternCueIndex];
  const tokenCount=Math.max(1,Math.min(8,cue?.sourceWordCount||sampleWords.length)),extras=["DEKHO","YEH","KAISA","ABHI","ACHA","KARO","WOW","NOW"].filter(word=>!sampleWords.includes(word)),tokens=[...sampleWords,...extras].slice(0,tokenCount);
  const words=tokens.map((text,index)=>({text,start:index*period/tokens.length,end:(index+1)*period/tokens.length})),segment={text:tokens.join(" "),start:0,end:period,words};
  const rect=canvas.getBoundingClientRect(),coverScale=Math.max(rect.width/canvas.width,rect.height/canvas.height),baseFont=canvas.height*theme.size/1080;let rows:string[]=[];
  if(theme.typographyCategory==="Stacked Typography")rows=tokens.map((_,index)=>[tokens.slice(0,index).join(" "),tokens.slice(index+1).join(" ")].filter(Boolean)).flat();
  else if(["side-stagger","duotone-stagger"].includes(theme.animation))rows=tokens;
  else{const weights=[...(cue?.rowWordCounts||[tokens.length])];while(weights.length>tokens.length&&weights.length>1)weights[weights.length-2]+=weights.pop()!;const total=weights.reduce((a,b)=>a+b,0)||1,counts=weights.map(weight=>Math.max(1,Math.floor(tokens.length*weight/total)));while(counts.reduce((a,b)=>a+b,0)>tokens.length){const index=counts.findIndex(count=>count>1);if(index<0)break;counts[index]--}while(counts.reduce((a,b)=>a+b,0)<tokens.length)counts[weights.indexOf(Math.max(...weights))]++;let cursor=0;rows=counts.map(count=>tokens.slice(cursor,cursor+=count).join(" "));}
  const lineCount=Math.max(1,theme.typographyCategory==="Stacked Typography"?3:rows.length),widestLine=Math.max(4,...rows.map(line=>line.length)),targetFont=Math.min(44,rect.height*.80/(lineCount*1.18),rect.width*.84/(widestLine*.70)),previewScale=Math.min(7,Math.max(1.2,targetFont/Math.max(1,baseFont*coverScale)));
  ctx.fillStyle="#050708";ctx.fillRect(0,0,canvas.width,canvas.height);drawCapsnipCaption(ctx,segment,time,canvas.width,canvas.height,theme.key,{x:.5,y:.52},previewScale,patternCueIndex);
}
