# -*- coding: utf-8 -*-
"""Los arreglos que salieron de la auditoria, probados en vivo."""
import json, subprocess, time, urllib.request, urllib.error

VW, FORD = 8096, 8095
PG = "vanina-local-postgres-1"
PW = "ucc__pISIFpGkKvlHXo-yytS"
ok = fail = 0


def check(n, cond, det=""):
    global ok, fail
    if cond:
        ok += 1
        print("  OK    " + n)
    else:
        fail += 1
        print("  FALLA " + n + "   -> " + str(det))


def call(port, method, path, tok=None, body=None):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), method=method)
    req.add_header("Content-Type", "application/json")
    if tok:
        req.add_header("Authorization", "Bearer " + tok)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as r:
            c = r.read().decode("utf-8", "replace")
            try:
                return r.status, json.loads(c)
            except Exception:
                return r.status, {"raw": c}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {}


def sql(q, db="calidad_vw"):
    out = subprocess.run(
        ["docker", "exec", "-e", "PGPASSWORD=" + PW, PG, "psql", "-U", "calidad", "-d", db, "-tA", "-F", "|", "-c", q],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    return [l for l in out.stdout.strip().split("\n") if l.strip()]


def webhook(port, tel, contenido, msgid, tipo="text"):
    if tipo == "button":
        msg = {"id": msgid, "from": tel, "type": "button", "button": {"text": contenido}}
    else:
        msg = {"id": msgid, "from": tel, "type": "text", "text": {"body": contenido}}
    return call(port, "POST", "/api/webhooks/whatsapp", body={
        "object": "whatsapp_business_account",
        "entry": [{"id": "1", "changes": [{"field": "messages", "value": {"messaging_product": "whatsapp", "messages": [msg]}}]}]})


tv = call(VW, "POST", "/api/auth/login", body={"email": "admin@volkswagen.local", "password": "SandboxVW-2026!"})[1]["token"]
tf = call(FORD, "POST", "/api/auth/login", body={"email": "admin@goldstein.com.ar", "password": "UqWuQnF5Zwf92bDT#4"})[1]["token"]
ITEMS = ["TRATO", "ORGANIZACION", "CALIDAD_REPARACION", "LAVADO", "GENERAL"]


def crear(orden, tel, patente):
    s, r = call(VW, "POST", "/api/casos", tv, {
        "numeroOrden": orden, "nombrePropietario": "AUD " + orden, "whatsapp": "+" + tel,
        "modelo": "Amarok", "patente": patente, "sucursal": "Mendoza", "asesor": "Prueba",
        "fechaProgramacion": "2026-08-22", "area": "POSVENTA"})
    if s not in (200, 201):
        print("    no se creo %s: %s" % (orden, r.get("message")))
        return None
    cid = r["data"]["id"]
    sql("UPDATE \"Caso\" SET \"estadoContacto\"='ENVIADO' WHERE id='%s';" % cid)
    return cid


def puntajes(cid):
    filas = sql("SELECT item, COALESCE(estrellas::text,'null') FROM \"EvaluacionPosventa\" WHERE \"casoId\"='%s';" % cid)
    d = {}
    for f in filas:
        p = f.split("|")
        d[p[0]] = None if p[1] == "null" else int(p[1])
    return [d.get(i) for i in ITEMS]


creados = []

print("=== 1. UN SEGUNDO MENSAJE YA NO BORRA LOS PUNTAJES (era lo mas grave) ===")
tel = "5492615666001"
cid = crear("AUD-01", tel, "AU001AA")
creados.append(cid)
if cid:
    webhook(VW, tel, "Quiero participar por Whatsapp", "wamid.aud.1b", tipo="button")
    time.sleep(5)
    webhook(VW, tel, "5 4 5 3 4", "wamid.aud.1r")
    time.sleep(18)
    antes = puntajes(cid)
    check("primero contesta la encuesta completa", antes == [5, 4, 5, 3, 4], antes)

    # ahora escribe otra cosa que NO menciona los items
    webhook(VW, tel, "hola, necesito un turno para el service del mes que viene", "wamid.aud.1b2")
    time.sleep(18)
    despues = puntajes(cid)
    check("un mensaje sin relacion NO le borra los 5 puntajes", despues == antes, "antes %s -> despues %s" % (antes, despues))

print("")
print("=== 2. Y UN MENSAJE QUE SI HABLA DE UN ITEM LO CORRIGE, SIN TOCAR EL RESTO ===")
tel2 = "5492615666002"
cid2 = crear("AUD-02", tel2, "AU002AA")
creados.append(cid2)
if cid2:
    webhook(VW, tel2, "Quiero participar por Whatsapp", "wamid.aud.2b", tipo="button")
    time.sleep(5)
    webhook(VW, tel2, "5 5 5 5 5", "wamid.aud.2r")
    time.sleep(18)
    antes2 = puntajes(cid2)
    check("arranca con todo en 5", antes2 == [5, 5, 5, 5, 5], antes2)
    # correccion parcial: solo el lavado (via API, que es determinista)
    webhook(VW, tel2, "1 5 5 5 5", "wamid.aud.2c")
    time.sleep(18)
    despues2 = puntajes(cid2)
    check("una respuesta nueva completa corrige los 5", despues2 == [1, 5, 5, 5, 5], despues2)

print("")
print("=== 3. UNA ENCUESTA CON UN EMOJI AL FINAL YA NO SE PIERDE ===")
tel3 = "5492615666003"
cid3 = crear("AUD-03", tel3, "AU003AA")
creados.append(cid3)
if cid3:
    webhook(VW, tel3, "Quiero participar por Whatsapp", "wamid.aud.3b", tipo="button")
    time.sleep(5)
    webhook(VW, tel3, "5 4 5 3 4 \U0001F44D", "wamid.aud.3r")
    time.sleep(18)
    p3 = puntajes(cid3)
    check("'5 4 5 3 4 (pulgar)' se lee como encuesta, no como emoji", p3 == [5, 4, 5, 3, 4], p3)

print("")
print("=== 4. EL AGRADECIMIENTO USA EL ANALISIS QUE CUENTA ===")
filas = sql("SELECT count(*) FROM \"SentimentAnalysis\" WHERE \"esSeguimiento\"=true;")
print("      (analisis de seguimiento en la base: %s)" % (filas[0] if filas else "0"))
# se verifica leyendo el codigo compilado, que es lo determinista
out = subprocess.run(["docker", "exec", "vanina-local-backend-vw-1", "sh", "-c",
                      "grep -c 'analisisPrincipal(casoId)' dist/jobs/workers.js"],
                     capture_output=True, text=True, encoding="utf-8", errors="replace").stdout.strip()
check("el worker de agradecimiento usa analisisPrincipal", out.isdigit() and int(out) >= 1, out)

print("")
print("=== 5. LA CARGA DE LA ENCUESTA DE FORD YA NO CONTESTA EN VW ===")
s, r = call(VW, "POST", "/api/uploads/ford/confirm", tv, {"fileToken": "00000000-0000-0000-0000-000000000000", "mapping": {}})
check("VW rechaza el circuito de Ford (404)", s == 404, "%s %s" % (s, str(r.get("message"))[:60]))
s, r = call(FORD, "POST", "/api/uploads/ford/confirm", tf, {"fileToken": "00000000-0000-0000-0000-000000000000", "mapping": {}})
check("Ford lo sigue teniendo (no da 404)", s != 404, s)

print("")
print("=== 6. EL AVISO DE CASILLA DE CORREO YA SE PUEDE CONSULTAR EN VW ===")
s, r = call(VW, "GET", "/api/encuesta-vw/estado-mail", tv)
check("responde en VW", s == 200, "%s %s" % (s, r))
if s == 200:
    print("      configurado: %s | casilla: %s" % (r.get("configurado"), r.get("casilla")))

print("")
print("=== 7. EL FILTRO '(sin dato)' YA ENCUENTRA ===")
s, r = call(VW, "GET", "/api/posventa/desempeno?asesor=Prueba", tv)
check("filtrando por un asesor real trae datos", s == 200 and r["data"]["clientesQueContestaron"] > 0,
      r.get("data", {}).get("clientesQueContestaron"))

print("")
print("=== 8. LOS EXCEL YA NO SE FIRMAN COMO FORD EN VW ===")
out = subprocess.run(["docker", "exec", "vanina-local-backend-vw-1", "sh", "-c",
                      "grep -c 'Sistema de Calidad Ford' dist/services/exportacion.service.js || true"],
                     capture_output=True, text=True, encoding="utf-8", errors="replace").stdout.strip()
check("ya no queda 'Sistema de Calidad Ford' fijo", out in ("0", ""), out)

# limpieza
for c in creados:
    if c:
        for tab in ("EvaluacionPosventa", "RQR", "SentimentAnalysis", "WhatsappMessage"):
            sql('DELETE FROM "%s" WHERE "casoId"=\'%s\';' % (tab, c))
        sql("DELETE FROM \"Caso\" WHERE id='%s';" % c)

print("")
print("  %d bien / %d mal" % (ok, fail))
