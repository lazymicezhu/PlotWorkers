/** Registered sixteen-pose artwork and fishing lines, driven only by game snapshots. */
import { FISHING_CYCLE_SECONDS, FISHING_SPRITE_LAYOUT } from "./fishing.ts";
import type { FishingOutcome, FishingSeatId } from "./fishing.ts";

type FishingPhase = "cast" | "idle" | "tug" | "catch" | "recover";
export type FishingAnimationSeat = {
  id: FishingSeatId;
  workerId: string;
  elapsed: number;
  phase: FishingPhase;
  progress: number;
  outcome: FishingOutcome;
};
type AtlasFrame = { x: number; y: number; width: number; height: number; rodTip: [number, number] };
type Atlas = { hip: [number, number]; frames: AtlasFrame[] };
type LoadedAtlas = { atlas: Atlas; image: HTMLImageElement };
type VisibleOutcome = { itemId: string | null; quantity: number; kind: string; label: string };
const clamp = (value: number,min=0,max=1) => Math.max(min,Math.min(max,Number(value)||0));
const lerp = (a: number,b: number,t: number) => a+(b-a)*t;
const smooth = (t: number) => { t=clamp(t);return t*t*(3-2*t); };
export const FISHING_ITEM_ART: Record<string, { label: string; kind: string }> = {
  rough: { label: "粗加工", kind: "product" },
  refined: { label: "精加工", kind: "product" },
  screws: { label: "螺丝", kind: "product" },
  rebar: { label: "钢筋", kind: "product" },
  cans: { label: "罐头", kind: "product" },
  canOpener: { label: "罐头起子", kind: "special" },
  smartLeader: { label: "智械领袖", kind: "special" },
  holyLight: { label: "圣光洗礼", kind: "special" },
  orderRefresh: { label: "订单刷新券", kind: "special" },
  goldenOrder: { label: "黄金卷", kind: "gold" },
};

export function visibleOutcomeForSeat(seat: Pick<FishingAnimationSeat, "outcome">): VisibleOutcome | null {
  const outcome=seat.outcome;
  if(outcome.kind === "empty" && outcome.quantity === 0 && outcome.itemId === null)
    return { itemId: null, quantity: 0, kind: "empty", label: "空杆" };
  const art=outcome.itemId ? FISHING_ITEM_ART[outcome.itemId] : undefined;
  if(!art || outcome.quantity !== 1 || outcome.kind !== art.kind) return null;
  return { itemId: outcome.itemId, quantity: 1, ...art };
}

export function poseForSeat(seat: Pick<FishingAnimationSeat, "progress" | "elapsed" | "phase" | "outcome">) {
  const p=clamp(seat.progress);
  const hasCatch=visibleOutcomeForSeat(seat)?.quantity===1;
  let sequence: number[],position: number;
  switch(seat.phase) {
    case "cast": sequence=[0,1,2,3,4];position=p*4.999;break;
    case "idle": sequence=[5,6,5,6];position=((Math.max(0,seat.elapsed-2.4)/2.65)%4);break;
    case "tug": sequence=[7,8,7,8,9];position=p*4.999;break;
    // The two raised-hand celebration poses are reserved for actual rewards.
    case "catch": sequence=hasCatch?[10,11,12,13]:[10,11,11,14];position=p*3.999;break;
    case "recover": sequence=[14,15,0];position=p*2.999;break;
    default: sequence=[0];position=0;
  }
  const index=Math.min(sequence.length-1,Math.floor(position));
  return {frame:sequence[index],nextFrame:sequence[Math.min(index+1,sequence.length-1)],blend:0};
}

/** A delayed simulation snapshot never lets artwork cross a reward boundary. */
export function interpolateFishingElapsed(elapsed: number, sinceSnapshotSeconds: number, speed: number, paused=false) {
  return Math.min(FISHING_CYCLE_SECONDS-.001, Math.max(0, elapsed) + (paused ? 0 : clamp(sinceSnapshotSeconds,0,1.25)*speed));
}

function ripple(ctx: CanvasRenderingContext2D,x: number,y: number,r: number,opacity: number) {
  ctx.save();ctx.globalAlpha=opacity;ctx.strokeStyle='#b9f5ff';ctx.lineWidth=3;
  ctx.beginPath();ctx.ellipse(x,y,r,r*.46,0,0,Math.PI*2);ctx.stroke();ctx.restore();
}

function bobber(ctx: CanvasRenderingContext2D,x: number,y: number,submerged=0) {
  ctx.save();ctx.translate(x,y+submerged*5);ctx.scale(1,1-submerged*.18);
  ctx.fillStyle='rgba(20,125,166,.19)';ctx.beginPath();ctx.ellipse(0,7,12,4,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#f7fdff';ctx.beginPath();ctx.ellipse(0,1,9,6,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ff774c';ctx.beginPath();ctx.ellipse(0,-3,7,6,0,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#fff1d1';ctx.lineWidth=2.8;ctx.beginPath();ctx.moveTo(0,-4);ctx.lineTo(0,-13);ctx.stroke();ctx.restore();
}

function reward(ctx: CanvasRenderingContext2D,x: number,y: number,itemId: string,rotation: number,alpha=1) {
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.globalAlpha=alpha;
  ctx.lineJoin='round';ctx.lineCap='round';
  if(itemId==='goldenOrder') {
    ctx.fillStyle='#ffd35b';ctx.strokeStyle='#fff5b7';ctx.lineWidth=3;
    ctx.beginPath();ctx.roundRect(-15,-19,30,38,4);ctx.fill();ctx.stroke();
    ctx.fillStyle='#f5a825';ctx.beginPath();
    for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?5:11;const px=Math.cos(a)*r,py=Math.sin(a)*r;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);}ctx.closePath();ctx.fill();
    ctx.strokeStyle='#fff2b4';ctx.lineWidth=2;
    for(const [sx,sy]of [[-22,-18],[23,11]]){ctx.beginPath();ctx.moveTo(sx-4,sy);ctx.lineTo(sx+4,sy);ctx.moveTo(sx,sy-4);ctx.lineTo(sx,sy+4);ctx.stroke();}
  } else if(itemId==='rough'||itemId==='refined') {
    const refined=itemId==='refined';
    ctx.strokeStyle=refined?'#d9f5ff':'#c7c8c0';ctx.lineWidth=2.3;
    ctx.fillStyle=refined?'#78b7ca':'#8c9696';
    ctx.beginPath();ctx.moveTo(-18,-8);ctx.lineTo(7,-14);ctx.lineTo(19,-6);ctx.lineTo(19,12);ctx.lineTo(-7,18);ctx.lineTo(-18,8);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle=refined?'#bbdfeb':'#b3b9b0';
    ctx.beginPath();ctx.moveTo(-18,-8);ctx.lineTo(7,-14);ctx.lineTo(19,-6);ctx.lineTo(-7,0);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(-7,0);ctx.lineTo(-7,18);ctx.stroke();
    if(refined){ctx.strokeStyle='#f2feff';ctx.beginPath();ctx.moveTo(9,-20);ctx.lineTo(9,-9);ctx.moveTo(4,-15);ctx.lineTo(14,-15);ctx.stroke();}
    else{ctx.strokeStyle='#6b7778';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-12,2);ctx.lineTo(-9,7);ctx.moveTo(2,6);ctx.lineTo(10,4);ctx.stroke();}
  } else if(itemId==='screws') {
    ctx.rotate(-.32);ctx.fillStyle='#a4b9c8';ctx.strokeStyle='#e5f5fc';ctx.lineWidth=2;
    ctx.beginPath();ctx.roundRect(-5,-9,10,26,2);ctx.fill();ctx.stroke();
    ctx.fillStyle='#d5e4e8';ctx.beginPath();ctx.ellipse(0,-11,13,7,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.strokeStyle='#708696';ctx.lineWidth=2.4;ctx.beginPath();ctx.moveTo(-6,-12);ctx.lineTo(6,-10);ctx.stroke();
    for(let y=-3;y<16;y+=5){ctx.beginPath();ctx.moveTo(-6,y);ctx.lineTo(6,y-3);ctx.stroke();}
  } else if(itemId==='rebar') {
    ctx.rotate(.4);
    for(const offset of [-10,0,10]){
      ctx.fillStyle='#7e98a8';ctx.strokeStyle='#d7eaf1';ctx.lineWidth=1.6;
      ctx.beginPath();ctx.roundRect(offset-3,-20,6,40,2);ctx.fill();ctx.stroke();
      ctx.strokeStyle='#435f72';for(let y=-14;y<19;y+=6){ctx.beginPath();ctx.moveTo(offset-4,y);ctx.lineTo(offset+4,y-2);ctx.stroke();}
    }
  } else if(itemId==='cans') {
    ctx.fillStyle='#ff8755';ctx.strokeStyle='#e1f3f8';ctx.lineWidth=2.2;
    ctx.beginPath();ctx.roundRect(-12,-16,24,32,3);ctx.fill();ctx.stroke();
    ctx.fillStyle='#fff7d8';ctx.fillRect(-11,-3,22,7);
    ctx.fillStyle='#c4d3d9';ctx.beginPath();ctx.ellipse(0,-16,12,4.5,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.strokeStyle='#778e98';ctx.lineWidth=1.6;ctx.beginPath();ctx.ellipse(0,-16,5,2.4,-.2,0,Math.PI*2);ctx.stroke();
  } else {
    // Purple marks the special pool; each item keeps its own readable symbol.
    ctx.fillStyle='#b792de';ctx.strokeStyle='#f4eaff';ctx.lineWidth=2.5;
    ctx.beginPath();ctx.roundRect(-17,-20,34,40,6);ctx.fill();ctx.stroke();
    ctx.strokeStyle='#fff7ff';ctx.fillStyle='#fff7ff';ctx.lineWidth=3;
    if(itemId==='orderRefresh'){
      ctx.beginPath();ctx.arc(0,0,9,-.65,Math.PI*1.15);ctx.stroke();
      ctx.beginPath();ctx.moveTo(8,-11);ctx.lineTo(9,-4);ctx.lineTo(2,-6);ctx.stroke();
    }else if(itemId==='canOpener'){
      ctx.beginPath();ctx.moveTo(-7,13);ctx.lineTo(5,-6);ctx.stroke();
      ctx.beginPath();ctx.arc(6,-8,6,-.2,Math.PI*1.55);ctx.stroke();
      ctx.beginPath();ctx.moveTo(-5,-6);ctx.lineTo(5,-6);ctx.stroke();
    }else if(itemId==='smartLeader'){
      ctx.beginPath();ctx.arc(0,-5,7,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(-4,3);ctx.lineTo(4,3);ctx.moveTo(-3,8);ctx.lineTo(3,8);ctx.stroke();
      for(const [x,y]of [[0,-17],[-12,-8],[12,-8]]){ctx.beginPath();ctx.arc(x,y,1.8,0,Math.PI*2);ctx.fill();}
    }else if(itemId==='holyLight'){
      ctx.beginPath();ctx.moveTo(0,-13);ctx.lineTo(4,-3);ctx.lineTo(11,0);ctx.lineTo(4,4);ctx.lineTo(0,14);ctx.lineTo(-4,4);ctx.lineTo(-11,0);ctx.lineTo(-4,-3);ctx.closePath();ctx.fill();
    }
  }
  ctx.restore();
}

function emptyHook(ctx: CanvasRenderingContext2D,x: number,y: number,alpha=1) {
  ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle='#eef9ff';ctx.lineWidth=2.4;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+10);ctx.bezierCurveTo(x,y+19,x+11,y+18,x+10,y+9);ctx.stroke();ctx.restore();
}

function outcomeLabel(ctx: CanvasRenderingContext2D,x: number,y: number,outcome: VisibleOutcome,alpha: number) {
  ctx.save();ctx.globalAlpha=alpha;ctx.font='600 21px system-ui, sans-serif';
  ctx.textAlign='center';ctx.textBaseline='middle';
  const width=ctx.measureText(outcome.label).width+25;
  ctx.fillStyle='rgba(249,253,255,.93)';ctx.strokeStyle='rgba(135,193,211,.4)';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.roundRect(x-width/2,y-17,width,34,17);ctx.fill();ctx.stroke();
  ctx.fillStyle=outcome.kind==='gold'?'#ae7614':outcome.kind==='special'?'#8b59b4':outcome.kind==='empty'?'#769ba8':'#347c94';
  ctx.fillText(outcome.label,x,y);ctx.restore();
}

function drawSeat(ctx: CanvasRenderingContext2D,asset: LoadedAtlas,seat: FishingAnimationSeat) {
  const {atlas,image}=asset;
  const id=seat.id;
  const layout=FISHING_SPRITE_LAYOUT[id], pose=poseForSeat(seat),frame=atlas.frames[pose.frame];
  const p=clamp(seat.progress),t=Number(seat.elapsed)||0;
  const x=layout.hip[0]-atlas.hip[0]*layout.scale,y=layout.hip[1]-atlas.hip[1]*layout.scale;
  const tip=[x+frame.rodTip[0]*layout.scale,y+frame.rodTip[1]*layout.scale];
  const float=[...layout.float];
  const phase=seat.phase;
  const outcome=visibleOutcomeForSeat(seat),hasCatch=outcome?.quantity===1;
  let lineEnd=[float[0],float[1]-8],lineAlpha=1,showBobber=true;
  if(phase==='cast') {
    if(p<.52){lineAlpha=0;showBobber=false;}
    else {const cast=smooth((p-.52)/.48);lineEnd=[lerp(tip[0],float[0],cast),lerp(tip[1],float[1]-8,cast)-Math.sin(cast*Math.PI)*70];}
  } else if(phase==='idle') {lineEnd[1]+=Math.sin(t*3.1+layout.order)*2;}
  else if(phase==='tug') {lineEnd[0]+=Math.sin(p*36)*3;lineEnd[1]+=Math.sin(p*23)*4+5;}
  else if(phase==='catch') {
    const lift=smooth(p/.60);lineEnd=[lerp(float[0],tip[0]+(id==='right'?-6:6),lift),lerp(float[1]-8,tip[1]+80,lift)];showBobber=false;
  } else if(phase==='recover') {lineAlpha=1-smooth(p*1.8);showBobber=false;lineEnd=[tip[0]+(id==='right'?-5:5),tip[1]+80];}
  if(phase==='idle'||phase==='tug'||phase==='catch'||(phase==='cast'&&p>.89)) {
    const strength=phase==='tug'?1.2:1, cycle=(t*.6+layout.order*.17)%1;
    ripple(ctx,float[0],float[1]+1,15+cycle*22,.45*(1-cycle)*strength);
    ripple(ctx,float[0],float[1]+1,28+cycle*22,.22*(1-cycle)*strength);
    if(phase==='catch'&&p<.45&&hasCatch) {
      const burst=p/.45;
      for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.fillStyle=`rgba(157,239,255,${(1-burst)*.9})`;ctx.beginPath();ctx.ellipse(float[0]+Math.cos(a)*burst*28,float[1]+Math.sin(a)*burst*13-Math.sin(burst*Math.PI)*32,2.8,5.3,a,0,Math.PI*2);ctx.fill();}
    }
  }
  if(lineAlpha>0) {
    ctx.save();ctx.globalAlpha=lineAlpha;ctx.strokeStyle='rgba(243,254,255,.92)';ctx.lineWidth=2.2;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(tip[0],tip[1]);
    const slack=phase==='cast'?12:phase==='idle'?4:0;
    ctx.quadraticCurveTo((tip[0]+lineEnd[0])/2+slack,(tip[1]+lineEnd[1])/2,lineEnd[0],lineEnd[1]);ctx.stroke();ctx.restore();
    if(showBobber)bobber(ctx,lineEnd[0],lineEnd[1]+8,phase==='tug'?.6:0);
  }
  if(phase==='catch' || (phase==='recover'&&p<.52)) {
    const alpha=phase==='recover'?lineAlpha:1;
    if(hasCatch)reward(ctx,lineEnd[0],lineEnd[1]+15,outcome!.itemId!,Math.sin(t*5)*.12,alpha);
    else emptyHook(ctx,lineEnd[0],lineEnd[1],alpha);
  }
  if(outcome&&((phase==='catch'&&p>.6)||(phase==='recover'&&p<.5))) {
    const alpha=phase==='catch'?smooth((p-.6)/.18):1-smooth(p/.5);
    outcomeLabel(ctx,float[0],float[1]+51,outcome,alpha);
  }
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(image,frame.x,frame.y,frame.width,frame.height,x,y,frame.width*layout.scale,frame.height*layout.scale);
}


let atlasPromise: Promise<Map<FishingSeatId, LoadedAtlas>> | undefined;
function loadAtlases() {
  if (!atlasPromise) {
    atlasPromise=Promise.all((["back", "left", "right"] as const).map(async id => {
      const image=new Image();
      const loaded=new Promise<HTMLImageElement>((resolve,reject) => {
        image.onload=() => resolve(image);
        image.onerror=() => reject(new Error(`无法加载垂钓动画 ${id}`));
        image.src=`/fishing/fishing-${id}.png`;
      });
      const [atlas,bitmap]=await Promise.all([
        fetch(`/fishing/fishing-${id}.json`).then(response => {
          if(!response.ok) throw new Error(`无法加载垂钓动作 ${id}`);
          return response.json() as Promise<Atlas>;
        }), loaded,
      ]);
      if(atlas.frames.length!==16) throw new Error(`垂钓动作 ${id} 不完整`);
      return [id,{atlas,image:bitmap}] as const;
    })).then(entries => new Map(entries));
    atlasPromise.catch(() => { atlasPromise=undefined; });
  }
  return atlasPromise;
}

/** One composited canvas retains the original back / left / right layer order. */
export function createPondAnimator(canvas: HTMLCanvasElement) {
  const ctx=canvas.getContext("2d");
  if(!ctx) throw new Error("无法创建垂钓动画画布");
  let disposed=false;
  let assets: Map<FishingSeatId, LoadedAtlas> | null=null;
  let current: FishingAnimationSeat[]=[];
  let lastKey="";
  function draw() {
    if(disposed || !assets) return;
    const key=current.map(seat => `${seat.id}:${seat.workerId}:${seat.elapsed.toFixed(3)}:${seat.outcome.itemId}`).join("|");
    if(key===lastKey) return;
    lastKey=key;
    ctx!.setTransform(1,0,0,1,0,0);
    ctx!.clearRect(0,0,canvas.width,canvas.height);
    ctx!.setTransform(canvas.width/1536,0,0,canvas.height/1024,0,0);
    for(const id of ["back","left","right"] as const) {
      const seat=current.find(candidate => candidate.id===id);
      const asset=assets.get(id);
      if(seat && asset) drawSeat(ctx!,asset,seat);
    }
    canvas.dataset.seats=JSON.stringify(current.map(seat => ({seat:seat.id,worker:seat.workerId,frame:poseForSeat(seat).frame,phase:seat.phase,elapsed:seat.elapsed,outcome:seat.outcome.itemId??"empty"})));
  }
  const ready=loadAtlases().then(loaded => {
    if(disposed) return;
    assets=loaded;
    lastKey="initial";
    draw();
  });
  return {
    ready,
    render(seats: FishingAnimationSeat[]) { current=seats; draw(); },
    resize(width: number,height: number) {
      if(canvas.width===width && canvas.height===height) return;
      canvas.width=width; canvas.height=height; lastKey="resized"; draw();
    },
    destroy() { disposed=true; current=[]; assets=null; ctx.clearRect(0,0,canvas.width,canvas.height); },
  };
}
