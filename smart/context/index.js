// /<module>/index.js
import './context.js'; // или './main.js' — просто выполняем основной код

const render = (typeof window !== 'undefined' && window.contextRender)
  ? window.contextRender
  : (mount) => {
      mount.innerHTML = '<div style="padding:16px;color:#900;">Module loaded but render missing.</div>';
    };

export default render;
export { render };
