import {useState,type CSSProperties} from 'react';
import {Palette} from 'lucide-react';

export function RulerSlider({label,value,min,max,step=1,onChange,unit=''}:{label:string;value:number;min:number;max:number;step?:number;onChange:(n:number)=>void;unit?:string}){
  const [hover,setHover]=useState<number|null>(null);
  const position=Math.max(0,Math.min(1,(value-min)/(max-min)));
  const focus=hover ?? position;
  return <div className="ruler-control"><div className="ruler-heading"><span>{label}</span><output>{Number(value.toFixed(2))}{unit}</output></div><div className="ruler-track" onPointerMove={event=>{const r=event.currentTarget.getBoundingClientRect();setHover(Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)));}} onPointerLeave={()=>setHover(null)}>
    <div className="ruler-ticks" aria-hidden="true">{Array.from({length:51},(_,i)=>{const p=i/50,d=Math.abs(p-focus),rise=Math.exp(-Math.pow(d/.09,2));return <i key={i} className={Math.abs(p-position)<.012?'selected':''} style={{height:`${(i%5===0?9:5)+rise*17}px`,opacity:.3+rise*.7} as CSSProperties}/>;})}</div>
    <span className="ruler-marker" style={{left:`${position*100}%`}} aria-hidden="true"/>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event=>onChange(Number(event.target.value))}/>
  </div></div>;
}

export function ColorPill({label,value,onChange}:{label:string;value:string;onChange:(color:string)=>void}){
  return <div className="color-pill-field"><span>{label}</span><label className="color-pill"><i style={{background:value}} aria-hidden="true"/><b>{value.toUpperCase()}</b><Palette size={13}/><input aria-label={label} type="color" value={value} onChange={event=>onChange(event.target.value)}/></label></div>;
}
