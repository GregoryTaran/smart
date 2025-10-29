// clientid.js
(function(){
  const KEY = 'smart_client_id';
  function uuidv4(){
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
      const r = Math.random()*16|0, v = c=='x'? r : (r&0x3|0x8);
      return v.toString(16);
    });
  }
  let id = localStorage.getItem(KEY);
  if(!id){
    id = uuidv4();
    localStorage.setItem(KEY, id);
  }
  window.SMART_CLIENT_ID = id;
})();
