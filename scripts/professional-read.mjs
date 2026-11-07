// Read-only HTTP client; never opens the SQLite file or acquires write privileges.
const [command, value='', extra='']=process.argv.slice(2);
const routes={domains:'/domains',search:'/search?'+new URLSearchParams({q:value,domain:extra}),read:'/read/'+encodeURIComponent(value),related:'/related/'+encodeURIComponent(value)};
if(!Object.hasOwn(routes,command)){console.error('Usage: node scripts/professional-read.mjs domains | search QUERY [DOMAIN_ID] | read ID | related ID');process.exitCode=1;}
else {
  const response=await fetch('http://127.0.0.1:5180/api/professional'+routes[command]);
  if(!response.ok)throw Error('Knowledge service returned '+response.status);
  console.log(JSON.stringify(await response.json(),null,2));
}
