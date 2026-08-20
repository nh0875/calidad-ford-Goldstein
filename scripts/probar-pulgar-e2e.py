# -*- coding: utf-8 -*-
"""Prueba de punta a punta del pulgar arriba.

Manda mensajes al WEBHOOK real, igual que WhatsApp, y mira como quedo clasificado
el caso. No simula nada del medio: pasa por el webhook, la cola y el worker.
"""
import json, subprocess, time, urllib.request, urllib.error

FORD = 8095
PG = "vanina-local-postgres-1"
PW = "ucc__pISIFpGkKvlHXo-yytS"
DB = "calidad_ford"
ok = fail = 0


def check(n, cond, det=""):
    global ok, fail
    if cond:
        ok += 1
        print("  OK    " + n)
    else:
        fail += 1
        print("  FALLA " + n + "   -> " + str(det))


def call(method, path, tok=None, body=None, port=FORD):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), method=method)
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


def webhook(telefono, contenido, msgid, tipo="text"):
    """Payload con la forma exacta que manda Meta."""
    if tipo == "reaction":
        msg = {"id": msgid, "from": telefono, "type": "reaction", "reaction": {"emoji": contenido, "message_id": "wamid.previo"}}
    else:
        msg = {"id": msgid, "from": telefono, "type": "text", "text": {"body": contenido}}
    payload = {"object": "whatsapp_business_account",
               "entry": [{"id": "1", "changes": [{"field": "messages", "value": {"messaging_product": "whatsapp", "messages": [msg]}}]}]}
    return call("POST", "/api/webhooks/whatsapp", body=payload)


tok = call("POST", "/api/auth/login", body={"email": "admin@goldstein.com.ar", "password": "UqWuQnF5Zwf92bDT#4"})[1]["token"]

# Los pulgares tal como pueden llegar de WhatsApp
PULGAR = "\U0001F44D"
CASOS = [
    ("pulgar pelado (U+1F44D)", PULGAR, "text"),
    ("pulgar con variation selector", PULGAR + "️", "text"),
    ("pulgar con tono de piel", PULGAR + "\U0001F3FD", "text"),
    ("pulgar como REACCION", PULGAR, "reaction"),
    ("pulgar con un espacio", " " + PULGAR + " ", "text"),
    ("dos pulgares", PULGAR + PULGAR, "text"),
    ("manos aplaudiendo", "\U0001F44F", "text"),
    ("corazon rojo", "❤️", "text"),
    # --- mixtos: cortesia + un emoji positivo. El pulgar es la valoracion. ---
    ("pulgar + gracias", PULGAR + " gracias", "text"),
    ("gracias + pulgar", "Gracias " + PULGAR, "text"),
    ("ok + pulgar", "ok " + PULGAR, "text"),
    ("muchas gracias + manito", "muchas gracias 🙏", "text"),
]

# Casos que NO tienen que quedar VERDE (control: la regla no se pasa de rosca)
NO_VERDE = [
    ("gracias solo", "muchas gracias", "text", "solo-cortesia"),
    ("buen dia solo", "buen dia", "text", "solo-cortesia"),
    ("pulgar ABAJO", "👎", "text", "reaccion-ambigua"),
    ("pulgar abajo + gracias", "👎 gracias", "text", "solo-cortesia"),
]

print("=== SE CREAN LOS CASOS DE PRUEBA ===")
creados = []
for i, (nombre, contenido, tipo) in enumerate(CASOS):
    tel = "54926150000%02d" % i
    s, r = call("POST", "/api/casos", tok, {
        "numeroOrden": "PULGAR-%02d" % i,
        "nombrePropietario": "PRUEBA %s" % nombre.upper()[:22],
        "whatsapp": "+" + tel,
        "modelo": "Ranger", "patente": "AA%03dAA" % (100 + i), "sucursal": "Mendoza",
        "asesor": "Prueba", "fechaProgramacion": "2026-08-20", "area": "POSVENTA",
    })
    if s not in (200, 201):
        print("    no se pudo crear el caso %d: %s %s" % (i, s, r.get("message")))
        continue
    cid = r.get("data", {}).get("id")
    # se lo pone como ya contactado, que es el estado real cuando el cliente contesta
    sql("UPDATE \"Caso\" SET \"estadoContacto\"='ENVIADO' WHERE id='%s';" % cid)
    sql("INSERT INTO \"WhatsappMessage\" (id,\"casoId\",direction,content,status,\"templateName\",\"createdAt\") "
        "VALUES ('salida-pulgar-%02d','%s','SALIENTE','Template contacto_posventa','enviado','contacto_posventa', now());" % (i, cid))
    creados.append((nombre, contenido, tipo, cid, tel))
print("  %d casos listos" % len(creados))

print("")
print("=== LLEGAN LOS PULGARES POR EL WEBHOOK ===")
for i, (nombre, contenido, tipo, cid, tel) in enumerate(creados):
    s, _ = webhook(tel, contenido, "wamid.pulgar.%02d" % i, tipo)
    if s != 200:
        print("    webhook devolvio %s para %s" % (s, nombre))

print("  esperando a que el worker analice…")
time.sleep(22)

print("")
print("=== COMO QUEDO CADA UNO ===")
for nombre, contenido, tipo, cid, tel in creados:
    filas = sql(
        "SELECT COALESCE(s.semaforo::text,'SIN CLASIFICAR'), s.\"requiereRevisionManual\", "
        "COALESCE(s.\"respuestaCrudaIA\"->>'motivo','-'), COALESCE(m.content,'?') "
        "FROM \"Caso\" c "
        "LEFT JOIN \"SentimentAnalysis\" s ON s.\"casoId\"=c.id "
        "LEFT JOIN \"WhatsappMessage\" m ON m.id=s.\"messageId\" "
        "WHERE c.id='%s' ORDER BY s.\"analyzedAt\" DESC LIMIT 1;" % cid)
    if not filas:
        check(nombre, False, "no quedo ningun analisis")
        continue
    partes = filas[0].split("|")
    semaforo = partes[0]
    revision = partes[1] if len(partes) > 1 else "?"
    motivo = partes[2] if len(partes) > 2 else "?"
    check("%-32s -> %s" % (nombre, semaforo), semaforo == "VERDE",
          "semaforo=%s revisionManual=%s motivo=%s" % (semaforo, revision, motivo))

print("")
print("=== SALIO EL MENSAJE DE AGRADECIMIENTO? ===")
for nombre, contenido, tipo, cid, tel in creados[:3]:
    filas = sql("SELECT count(*) FROM \"WhatsappMessage\" WHERE \"casoId\"='%s' AND \"esAgradecimiento\"=true;" % cid)
    n = filas[0] if filas else "0"
    print("  %-32s mensajes de agradecimiento: %s" % (nombre, n))

print("")
print("=== CONTROL: lo que NO tiene que quedar verde ===")
controles = []
for j, (nombre, contenido, tipo, espera) in enumerate(NO_VERDE):
    i = 100 + j
    tel = "5492615000%03d" % i
    s, r = call("POST", "/api/casos", tok, {
        "numeroOrden": "PULGAR-C%02d" % j,
        "nombrePropietario": "CONTROL %s" % nombre.upper()[:20],
        "whatsapp": "+" + tel,
        "modelo": "Ranger", "patente": "AB%03dAA" % i, "sucursal": "Mendoza",
        "asesor": "Prueba", "fechaProgramacion": "2026-08-20", "area": "POSVENTA",
    })
    if s not in (200, 201):
        print("    no se pudo crear el control %d: %s" % (j, r.get("message")))
        continue
    cid = r.get("data", {}).get("id")
    sql("UPDATE \"Caso\" SET \"estadoContacto\"='ENVIADO' WHERE id='%s';" % cid)
    sql("INSERT INTO \"WhatsappMessage\" (id,\"casoId\",direction,content,status,\"templateName\",\"createdAt\") "
        "VALUES ('salida-ctrl-%02d','%s','SALIENTE','Template','enviado','contacto_posventa', now());" % (j, cid))
    webhook(tel, contenido, "wamid.ctrl.%02d" % j, tipo)
    controles.append((nombre, espera, cid))

time.sleep(20)
for nombre, espera, cid in controles:
    filas = sql("SELECT COALESCE(s.semaforo::text,'SIN CLASIFICAR'), COALESCE(s.\"respuestaCrudaIA\"->>'motivo','-') "
                "FROM \"SentimentAnalysis\" s WHERE s.\"casoId\"='%s' ORDER BY s.\"analyzedAt\" DESC LIMIT 1;" % cid)
    if not filas:
        check(nombre, False, "sin analisis")
        continue
    partes = filas[0].split("|")
    check("%-24s NO quedo verde (%s)" % (nombre, partes[0]), partes[0] != "VERDE", partes)

for nombre, espera, cid in controles:
    sql("DELETE FROM \"SentimentAnalysis\" WHERE \"casoId\"='%s';" % cid)
    sql("DELETE FROM \"WhatsappMessage\" WHERE \"casoId\"='%s';" % cid)
    sql("DELETE FROM \"Caso\" WHERE id='%s';" % cid)

# limpieza
for nombre, contenido, tipo, cid, tel in creados:
    sql("DELETE FROM \"SentimentAnalysis\" WHERE \"casoId\"='%s';" % cid)
    sql("DELETE FROM \"WhatsappMessage\" WHERE \"casoId\"='%s';" % cid)
    sql("DELETE FROM \"Caso\" WHERE id='%s';" % cid)

print("")
print("  %d bien / %d mal" % (ok, fail))
