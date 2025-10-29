// voicerecorderclient.js
document.addEventListener('DOMContentLoaded', ()=>{
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const stopBtn  = document.getElementById('stopBtn');

  // простой лог — позже подключим аудио
  startBtn.addEventListener('click', ()=> console.log('Start pressed'));
  pauseBtn.addEventListener('click', ()=> console.log('Pause pressed'));
  stopBtn.addEventListener('click', ()=> console.log('Stop pressed'));

  // placeholder: отрисовка простого VU (анимация)
  const canvas = document.getElementById('rec-wave');
  if(canvas && canvas.getContext){
    const ctx = canvas.getContext('2d');
    let t=0;
    function frame(){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = '#0f9';
      const w = canvas.width, h = canvas.height;
      for(let i=0;i<30;i++){
        const amp = (Math.sin(t + i*0.3)+1)/2;
        const ph = i*(w/30);
        const rh = amp*h*0.6;
        ctx.fillRect(ph, (h-rh)/2, (w/30)-2, rh);
      }
      t += 0.05;
      requestAnimationFrame(frame);
    }
    frame();
  }
});
