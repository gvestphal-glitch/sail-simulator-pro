const roomLife = 3 * 60 * 60_000;
const racePreparation = 8 * 60_000;
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const noCache = { "Cache-Control": "no-store" };
const json = (data, status = 200) => Response.json(data, { status, headers: noCache });
const failure = (error, status) => json({ error }, status);
const roomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(7)), n => alphabet[n & 31]).join("");
const textName = value => typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
const limits = {
  wind: [0,60], gust: [0,90], dir: [0,360], wave: [0,12], waveDir: [0,360], period: [1,30],
  tide: [-5,5], tideRate: [-3,3], current: [0,4], currentDir: [0,360]
};
const boatLimits = {
  x: [-100000,100000], y: [-100000,100000], h: [-100000,100000], vx: [-25,25], vy: [-25,25],
  speed: [0,25], waterSpeed: [0,25], heel: [-4,4], pitch: [-2,2], heave: [-15,15],
  rudderAngle: [-2,2], downSide: [-1,1], stage: [0,40], main: [0,100], jib: [0,100],
  mainAngle: [-3.2,3.2], jibAngle: [-3.2,3.2], crewPose: [-3,3], extraHike: [0,1]
};

function checkedNumbers(input, ranges) {
  if (!input || typeof input !== "object") return null;
  const numbers = {};
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = input[key];
    if (!Number.isFinite(value) || value < min || value > max) return null;
    numbers[key] = value;
  }
  return numbers;
}

function checkedSettings(input) {
  if (!input || !["central","north","canas","rio"].includes(input.venue) ||
      !["ilca","snipe","optimist","star","soto40","clubswan36","tp52","brasil40","columbia50","arpege30","cal40"].includes(input.boatClass) ||
      !["mixed","clear","cloudy","rain"].includes(input.sky)) return null;
  const weather = checkedNumbers(input.weather, limits);
  if (!weather) return null;
  if (input.venue === "canas") weather.dir = 90;
  weather.gust = Math.max(weather.wind, weather.gust);
  return { venue: input.venue, boatClass: input.boatClass, sky: input.sky === "rain" ? "cloudy" : input.sky, windShift: input.windShift === true, weather };
}

async function view(db, room, now) {
  const { results } = await db.prepare("SELECT seat,id,name,seen,boat FROM sailors WHERE room=? ORDER BY seat").bind(room.code).all();
  return {
    code: room.code, settings: JSON.parse(room.settings), starts: room.starts, now,
    players: results.map(({seat,id,name,seen,boat})=>({seat,id,name,online:now-seen<9000,boat:boat?JSON.parse(boat):null}))
  };
}

async function api(request, database, action) {
  if (request.method !== "POST") return failure("Método inválido.", 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return failure("Origem inválida.", 403);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) return failure("Formato inválido.", 415);
  const content = await request.text();
  if (content.length > 4096) return failure("Pedido muito grande.", 413);
  let data;
  try { data = JSON.parse(content); } catch { return failure("Pedido inválido.", 400); }
  if (!data || typeof data !== "object") return failure("Pedido inválido.", 400);

  const now = Date.now();
  const db = database.withSession?.("first-primary") ?? database;
  const name = textName(data.name);
  const code = typeof data.code === "string" ? data.code.toUpperCase() : "";
  if (action === "create" || action === "join") {
    if (name.length < 1 || name.length > 24 || /[\p{Cc}\p{Cf}]/u.test(name)) return failure("Digite um nome de até 24 caracteres.", 400);
    const id = crypto.randomUUID(), token = crypto.randomUUID();
    if (action === "create") {
      const settings = checkedSettings(data.settings);
      if (!settings) return failure("Confira as condições da raia.", 400);
      const room = { code: roomCode(), settings: JSON.stringify(settings), starts: null };
      await db.batch([
        db.prepare("DELETE FROM rooms WHERE expires < ?").bind(now),
        db.prepare("INSERT INTO rooms(code,settings,created,expires) VALUES (?,?,?,?)").bind(room.code,room.settings,now,now+roomLife),
        db.prepare("INSERT INTO sailors(room,seat,id,token,name,seen) VALUES (?,0,?,?,?,?)").bind(room.code,id,token,name,now)
      ]);
      return json({ ...(await view(db, room, now)), id, token });
    }
    if (!/^[A-Z2-9]{7}$/.test(code)) return failure("Digite os 7 caracteres do código.", 400);
    const room = await db.prepare("SELECT * FROM rooms WHERE code=? AND expires>?").bind(code,now).first();
    if (!room) return failure("Sala não encontrada ou expirada.", 404);
    if (room.starts) return failure("A regata desta sala já começou.", 409);
    await db.prepare(`DELETE FROM sailors WHERE room=? AND seat>0 AND seen<? AND
      EXISTS(SELECT 1 FROM rooms WHERE code=? AND starts IS NULL)`).bind(code,now-90000,code).run();
    const result = await db.prepare(`INSERT INTO sailors(room,seat,id,token,name,seen)
      SELECT ?, free.seat, ?, ?, ?, ? FROM (SELECT 1 AS seat UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) free
      WHERE EXISTS (SELECT 1 FROM rooms WHERE code=? AND starts IS NULL AND expires>?)
        AND NOT EXISTS (SELECT 1 FROM sailors WHERE room=? AND seat=free.seat) ORDER BY free.seat LIMIT 1`)
      .bind(code,id,token,name,now,code,now,code).run();
    if (!result.meta.changes) return failure("A sala está cheia ou a regata já começou.", 409);
    return json({ ...(await view(db, room, now)), id, token });
  }

  if (!/^[A-Z2-9]{7}$/.test(code) || typeof data.token !== "string" || data.token.length !== 36) return failure("Sala indisponível.", 404);
  const member = await db.prepare(`SELECT rooms.*, sailors.seat FROM rooms
    JOIN sailors ON sailors.room=rooms.code WHERE rooms.code=? AND sailors.token=? AND rooms.expires>?`)
    .bind(code,data.token,now).first();
  if (!member) return failure("A sala foi encerrada ou expirou.", 404);
  if (action === "leave") {
    const stmt = member.seat === 0 && !member.starts
      ? db.prepare("DELETE FROM rooms WHERE code=? AND starts IS NULL").bind(code)
      : db.prepare("DELETE FROM sailors WHERE room=? AND token=?").bind(code,data.token);
    await stmt.run();
    return json({ ok:true });
  }
  if (action === "start" || action === "configure") {
    if (member.seat !== 0) return failure("Somente o anfitrião pode ajustar ou iniciar a regata.", 403);
    if (member.starts) return failure("A regata desta sala já começou.", 409);
    const settings = data.settings == null ? JSON.parse(member.settings) : checkedSettings(data.settings);
    if (!settings) return failure("Confira as condições da raia.", 400);
    const starts=action === "start" ? now+racePreparation : null;
    await db.prepare("UPDATE rooms SET starts=?,settings=? WHERE code=? AND starts IS NULL")
      .bind(starts,JSON.stringify(settings),code).run();
  } else if (action !== "sync") return failure("Ação indisponível.", 404);

  let boat = null;
  if (member.starts && data.boat != null) {
    boat = checkedNumbers(data.boat, boatLimits);
    if (!boat) return failure("Posição inválida.", 400);
    if(data.boat.soto){
      boat.soto=checkedNumbers(data.boat.soto,{jib:[1,3],spi:[0,1]});
      if(boat.soto && Number.isFinite(data.boat.soto.sheet))boat.soto.sheet=Math.max(0,Math.min(100,data.boat.soto.sheet));
      if(boat.soto && data.boat.soto.ease===1)boat.soto.ease=1;
      if(!boat.soto||!Number.isInteger(boat.soto.jib)||!Number.isInteger(boat.soto.spi))return failure("Inventário inválido.",400);
    }
    if(data.boat.starRig){
      boat.starRig=checkedNumbers(data.boat.starRig,{outhaul:[0,1],cunningham:[0,1],runner:[0,1]});
      if(!boat.starRig)return failure("Ajuste do aparelho inválido.",400);
    }
    if(data.boat.starMotion){
      boat.starMotion=checkedNumbers(data.boat.starMotion,{stand:[0,1],fore:[-1,1],side:[-1,1]});
      if(!boat.starMotion)return failure("Movimento do proeiro inválido.",400);
    }
    boat.stage = Math.trunc(boat.stage);
    boat.downSide = Math.sign(boat.downSide);
    boat.finish = Number.isFinite(data.boat.finish) && data.boat.finish >= 0 ? Math.min(10800,data.boat.finish) : null;
  }
  await db.prepare("UPDATE sailors SET seen=?,boat=COALESCE(?,boat) WHERE room=? AND token=?")
    .bind(now,boat?JSON.stringify(boat):null,code,data.token).run();
  const current = await db.prepare("SELECT * FROM rooms WHERE code=?").bind(code).first();
  if (!current) return failure("A sala foi encerrada.", 404);
  return json(await view(db, current, now));
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/rooms/")) {
      if (!env.DB) return failure("Serviço de salas indisponível.", 503);
      try { return await api(request, env.DB, pathname.split("/").pop()); }
      catch (error) {
        console.error("Room request failed", error);
        return failure("Não foi possível conectar à sala.", 503);
      }
    }
    const entry = assets[pathname === "/" ? "/index.html" : pathname];
    if (!entry || !["GET","HEAD"].includes(request.method)) return new Response("Página não encontrada.", {status:404});
    const [type,etag,base64] = entry;
    const headers = { "Content-Type":type, ETag:etag, "Cache-Control":"public, max-age=0, must-revalidate" };
    if (request.headers.get("If-None-Match") === etag) return new Response(null,{status:304,headers});
    return new Response(request.method === "HEAD" ? null : Uint8Array.from(atob(base64), character => character.charCodeAt(0)),{headers});
  }
};
