const fs=require('node:fs');
const images={};
for(const name of ['mascot-play.png','mascot-rest.png']) images['/'+name]=fs.readFileSync('dist/'+name).toString('base64');
fs.writeFileSync('dist/server/images.js','export default '+JSON.stringify(images)+';\n');
