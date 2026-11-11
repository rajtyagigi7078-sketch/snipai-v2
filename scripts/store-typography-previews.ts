import {loadCapsnipTypographyFonts,paintCapsnipTemplateSample,CAPSNIP_TYPOGRAPHY_CATALOG} from '../src/editor/capsnipTypography';
async function main(){
 await loadCapsnipTypographyFonts();
 const results=[];
 for(const theme of CAPSNIP_TYPOGRAPHY_CATALOG.slice(0,10)){
  const canvas=document.createElement('canvas');canvas.width=800;canvas.height=500;
  canvas.style.cssText='width:800px;height:500px';document.body.append(canvas);
  paintCapsnipTemplateSample(canvas,theme.key,2.35);
  results.push({id:theme.id,name:theme.name,image:canvas.toDataURL('image/png')});canvas.remove();
 }
 (window as any).stylePreviews=results;
}
main().catch(e=>{(window as any).previewError=String(e)});
