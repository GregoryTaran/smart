const express = require('express');
const path = require('path');
const app = express();
const SMART_ROOT = path.join(__dirname, '..', 'smart');
const PORT = process.env.PORT || 10000;
app.use(express.static(SMART_ROOT, { extensions:['html'] }));
app.use((req, res, next) => {
  const reserved = ['/menu.html','/topbar.html','/footer.html','/css/','/js/','/assets/'];
  if (reserved.some(p => req.path.startsWith(p))) {
    return res.status(404).send('Not found');
  }
  next();
});
app.get('*', (req, res) => res.sendFile(path.join(SMART_ROOT, 'index.html')));
app.listen(PORT, () => console.log(`Static server listening on ${PORT}`));
