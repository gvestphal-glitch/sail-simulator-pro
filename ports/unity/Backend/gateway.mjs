import rooms from './worker.mjs';
// Attach the existing DB binding and a static assets binding named ASSETS.
// Stage the legacy game at / and a Unity Web build at /unity/.
export default {fetch(request,env){
 const {pathname}=new URL(request.url);
 return pathname.startsWith('/api/rooms/')?rooms.fetch(request,env):env.ASSETS.fetch(request);
}};
