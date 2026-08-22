# -*- coding: utf-8 -*-
"""Los dos huecos que aparecieron auditando la encuesta de Posventa:

1. El boton "Quiero participar por Llamada" no estaba contemplado: el sistema lo
   analizaba como si fuera una opinion, le contestaba el mensaje automatico
   equivocado, y nadie se enteraba de que el cliente pidio un llamado.
2. Los 5 puntajes no se veian en la conversacion del cliente: se veia que el caso
   quedo en 4 estrellas pero no POR QUE.
"""
import json, subprocess, time, urllib.request, urllib.error

VW = 8096
PG = "vanina-local-postgres-1"
PW = "ucc__pISIFpGkKvlHXo-yytS"
DB = "calidad_vw"
ok = fail = 0


def check(n, cond, det=""):
    global ok, fail
    if cond:
        ok += 1
        print("  OK    " + n)
    else:
        fail += 1
        print("  FALLA " + n + "   -> " + str(det))


def call(method, path, tok=None, body=None):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (VW, path), method=method)
    req.add_header("Content-Type", "application/json")
    if tok:
        req.add_header("Authorization", "Bearer " + tok)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as r:
            cuerpo = r.read().decode("utf-8", "replace")
            try:
                return r.status, json.loads(cuerpo)
            except Exception:
                return r.status, {"raw": cuerpo}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {}


def sql(q):
    out = subprocess.run(
        ["docker", "exec", "-e", "PGPASSWORD=" + PW, PG, "psql", "-U", "calidad", "-d", DB, "-tA", "-F", "|", "-c", q],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    return [l for l in out.stdout.strip().split("\n") if l.strip()]


def webhook(tel, contenido, msgid, tipo="text"):
    if tipo == "button":
        msg = {"id": msgid, "from": tel, "type": "button", "button": {"text": contenido}}
    else:
        msg = {"id": msgid, "from": tel, "type": "text", "text": {"body": contenido}}
    return call("POST", "/api/webhooks/whatsapp", body={
        "object": "whatsapp_business_account",
        "entry": [{"id": "1", "changes": [{"field": "messages", "value": {"messaging_product": "whatsapp", "messages": [msg]}}]}]})


def crear(orden, tel, patente):
    s, r = call("POST", "/api/casos", tok, {
        "numeroOrden": orden, "nombrePropietario": "CLIENTE " + orden,
        "whatsapp": "+" + tel, "modelo": "Amarok", "patente": patente,
        "sucursal": "Mendoza", "asesor": "Prueba", "fechaProgramacion": "2026-08-21", "area": "POSVENTA"})
    if s not in (200, 201):
        print("    no se pudo crear %s: %s" % (orden, r.get("message")))
        return None
    cid = r["data"]["id"]
    sql("UPDATE \"Caso\" SET \"estadoContacto\"='ENVIADO' WHERE id='%s';" % cid)
    return cid


tok = call("POST", "/api/auth/login", body={"email": "admin@volkswagen.local", "password": "SandboxVW-2026!"})[1]["token"]

print("=== 1. EL BOTON DE LLAMADA ===")
tel = "5492615888001"
cid = crear("LLAM-A1", tel, "LA001AA")
if cid:
    webhook(tel, "Quiero participar por Llamada", "wamid.ll.a1", tipo="button")
    time.sleep(18)

    filas = sql("SELECT \"quiereLlamadoEn\" IS NOT NULL, \"estadoContacto\" FROM \"Caso\" WHERE id='%s';" % cid)
    p = filas[0].split("|") if filas else ["?", "?"]
    check("queda anotado que pidio que lo llamen", p[0] == "t", filas)
    check("el caso figura como RESPONDIDO", p[1] == "RESPONDIDO", p[1])

    filas = sql("SELECT count(*) FROM \"SentimentAnalysis\" WHERE \"casoId\"='%s';" % cid)
    check("NO se analiza (pedir un llamado no es una opinion)", filas and filas[0] == "0", filas)

    filas = sql("SELECT count(*) FROM \"WhatsappMessage\" WHERE \"casoId\"='%s' AND direction='SALIENTE';" % cid)
    check("NO se le manda ningun mensaje automatico", filas and filas[0] == "0", filas)

    s, hilo = call("GET", "/api/seguimiento/caso:" + cid, tok)
    check("la pantalla lo muestra como 'quiere llamado'", s == 200 and hilo["data"]["caso"].get("quiereLlamado") is True,
          hilo.get("data", {}).get("caso", {}).get("quiereLlamado"))

print("")
print("=== 2. EL BOTON DE WHATSAPP SIGUE ANDANDO (no se rompio) ===")
tel2 = "5492615888002"
cid2 = crear("LLAM-A2", tel2, "LA002AA")
if cid2:
    webhook(tel2, "Quiero participar por Whatsapp", "wamid.ll.a2", tipo="button")
    time.sleep(6)
    filas = sql("SELECT \"encuestaItemsEnviadaEn\" IS NOT NULL, \"quiereLlamadoEn\" IS NULL FROM \"Caso\" WHERE id='%s';" % cid2)
    p = filas[0].split("|") if filas else ["?", "?"]
    check("se le mandaron las preguntas", p[0] == "t", filas)
    check("y NO quedo marcado como 'quiere llamado'", p[1] == "t", filas)

print("")
print("=== 3. LOS 5 PUNTAJES SE VEN EN LA CONVERSACION ===")
if cid2:
    webhook(tel2, "5 4 5 1 4", "wamid.ll.a2r")
    time.sleep(18)
    s, hilo = call("GET", "/api/seguimiento/caso:" + cid2, tok)
    pts = hilo.get("data", {}).get("puntajesPosventa")
    check("la conversacion devuelve los puntajes", isinstance(pts, list) and len(pts) == 5, pts)
    if isinstance(pts, list) and len(pts) == 5:
        valores = [p["estrellas"] for p in pts]
        check("con los valores correctos", valores == [5, 4, 5, 1, 4], valores)
        print("      " + " · ".join("%s %s" % (p["etiqueta"], p["estrellas"]) for p in pts))
        lavado = [p for p in pts if p["item"] == "LAVADO"]
        check("se ve que el LAVADO fue 1 (el por que del semaforo)", lavado and lavado[0]["estrellas"] == 1, lavado)

print("")
print("=== 4. EN FORD ESTO NO EXISTE ===")
req = urllib.request.Request("http://127.0.0.1:8095/api/marca")
with urllib.request.urlopen(req) as r:
    m = json.load(r)
check("Ford no anuncia el modulo de desempeno", m["modulos"]["desempenoPosventa"] is False, m["modulos"])

# limpieza
for c in (cid, cid2):
    if c:
        sql("DELETE FROM \"EvaluacionPosventa\" WHERE \"casoId\"='%s';" % c)
        sql("DELETE FROM \"RQR\" WHERE \"casoId\"='%s';" % c)
        sql("DELETE FROM \"SentimentAnalysis\" WHERE \"casoId\"='%s';" % c)
        sql("DELETE FROM \"WhatsappMessage\" WHERE \"casoId\"='%s';" % c)
        sql("DELETE FROM \"Caso\" WHERE id='%s';" % c)

print("")
print("  %d bien / %d mal" % (ok, fail))
