// smart/context/index.js
// Tiny ES-module wrapper so dynamic imports like "/context/index.js" succeed.

import './context.js'; // запускает smart/context/context.js, который устанавливает window.contextRender

const render = (typeof window !== 'undefined' && window.contextRender)
  ? window.contextRender
  : function fallbackRender(mount) {
      mount.innerHTML = '<div style="padding:16px;color:#900;">Context module loaded, but render() is not available.</div>';
      console.error('contextRender not found on window — проверь smart/context/context.js');
    };

export default render;
export { render };
