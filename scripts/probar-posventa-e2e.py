# -*- coding: utf-8 -*-
"""Encuesta de Posventa por items, de punta a punta.

Pasa por el WEBHOOK real: el cliente aprieta el boton, el sistema le manda las 5
preguntas, el cliente contesta, y se verifica que cada item quede puntuado por
separado y que el reporte y las exportaciones salgan bien.
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


def call(method, path, tok=None, body=None, crudo=False):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (VW, path), method=method)
    req.add_header("Content-Type", "application/json")
    if tok:
        req.add_header("Authorization", "Bearer " + tok)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as r:
            if crudo:
                return r.status, r.read()
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
    payload = {"object": "whatsapp_business_account",
               "entry": [{"id": "1", "changes": [{"field": "messages", "value": {"messaging_product": "whatsapp", "messages": [msg]}}]}]}
    return call("POST", "/api/webhooks/whatsapp", body=payload)


tok = call("POST", "/api/auth/login", body={"email": "admin@volkswagen.local", "password": "SandboxVW-2026!"})[1]["token"]
ITEMS = ["TRATO", "ORGANIZACION", "CALIDAD_REPARACION", "LAVADO", "GENERAL"]

# Cada caso: (nombre, respuesta del cliente, puntajes esperados o None si no importa)
CLIENTES = [
    ("numeros", "5 4 5 3 4", [5, 4, 5, 3, 4], "Diaz"),
    ("numeros con coma", "5,5,5,1,4", [5, 5, 5, 1, 4], "Diaz"),
    ("todo cinco", "5 5 5 5 5", [5, 5, 5, 5, 5], "Perez"),
    ("con comentario", "4 4 5 2 4 el lavado dejo mucho que desear", [4, 4, 5, 2, 4], "Perez"),
]

print("=== 1. SE CREAN LOS CASOS Y SE LES MANDA LA PLANTILLA ===")
creados = []
for i, (nombre, respuesta, esperados, asesor) in enumerate(CLIENTES):
    tel = "5492615777%03d" % i
    s, r = call("POST", "/api/casos", tok, {
        "numeroOrden": "PV-%03d" % i,
        "nombrePropietario": "CLIENTE POSVENTA %d" % i,
        "whatsapp": "+" + tel,
        "modelo": "Amarok", "patente": "PV%03dAA" % i, "sucursal": "Mendoza",
        "asesor": asesor, "fechaProgramacion": "2026-08-21", "area": "POSVENTA",
    })
    if s not in (200, 201):
        print("    no se pudo crear: %s %s" % (s, r.get("message")))
        continue
    cid = r["data"]["id"]
    sql("UPDATE \"Caso\" SET \"estadoContacto\"='ENVIADO' WHERE id='%s';" % cid)
    sql("INSERT INTO \"WhatsappMessage\" (id,\"casoId\",direction,content,status,\"templateName\",\"createdAt\") "
        "VALUES ('sal-pv-%03d','%s','SALIENTE','Template contacto_posventa','enviado','contacto_posventa', now());" % (i, cid))
    creados.append((nombre, respuesta, esperados, cid, tel))
print("  %d casos listos" % len(creados))

print("")
print("=== 2. EL CLIENTE APRIETA \"Quiero participar por Whatsapp\" ===")
for i, (nombre, respuesta, esperados, cid, tel) in enumerate(creados):
    webhook(tel, "Quiero participar por Whatsapp", "wamid.pv.boton.%03d" % i, tipo="button")
time.sleep(4)

for nombre, respuesta, esperados, cid, tel in creados[:1]:
    filas = sql("SELECT \"encuestaItemsEnviadaEn\" IS NOT NULL FROM \"Caso\" WHERE id='%s';" % cid)
    check("queda marcado que se le mandaron las preguntas", filas and filas[0] == "t", filas)
    filas = sql("SELECT content FROM \"WhatsappMessage\" WHERE \"casoId\"='%s' AND direction='SALIENTE' "
                "AND \"esAgradecimiento\"=true ORDER BY \"createdAt\" DESC LIMIT 1;" % cid)
    tiene5 = filas and filas[0].count("?") >= 0 and len(filas[0]) > 50
    check("se le mando el mensaje con las preguntas", bool(filas), filas)
    if filas:
        print("      texto enviado: " + filas[0][:120].replace("\n", " / "))
    # el boton NO se analiza: apretar un boton no es una opinion
    filas = sql("SELECT count(*) FROM \"SentimentAnalysis\" WHERE \"casoId\"='%s';" % cid)
    check("el boton NO genero un analisis", filas and filas[0] == "0", filas)

print("")
print("=== 3. EL CLIENTE CONTESTA LAS 5 PREGUNTAS ===")
for i, (nombre, respuesta, esperados, cid, tel) in enumerate(creados):
    webhook(tel, respuesta, "wamid.pv.resp.%03d" % i)
print("  esperando al worker...")
time.sleep(22)

for nombre, respuesta, esperados, cid, tel in creados:
    filas = sql("SELECT item, COALESCE(estrellas::text,'null') FROM \"EvaluacionPosventa\" "
                "WHERE \"casoId\"='%s';" % cid)
    puntajes = {}
    for f in filas:
        p = f.split("|")
        puntajes[p[0]] = None if p[1] == "null" else int(p[1])
    reales = [puntajes.get(it) for it in ITEMS]
    check("%-22s %-38s -> %s" % (nombre, repr(respuesta)[:36], reales), reales == esperados, "se esperaba %s" % esperados)

print("")
print("=== 4. EL ITEM GENERAL DEFINE EL CASO (y es el unico que abre RQR) ===")
nombre, respuesta, esperados, cid, tel = creados[1]  # 5,5,5,1,4 -> lavado 1, general 4
filas = sql("SELECT COALESCE(semaforo::text,'null'), COALESCE(estrellas::text,'null'), \"requiereRQR\" "
            "FROM \"SentimentAnalysis\" WHERE \"casoId\"='%s' ORDER BY \"analyzedAt\" DESC LIMIT 1;" % cid)
if filas:
    sem, est, rqr = filas[0].split("|")
    check("el caso toma el puntaje GENERAL (4), no el del lavado (1)", est == "4", "estrellas=%s" % est)
    check("4 estrellas -> AMARILLO", sem == "AMARILLO", sem)
    check("abre RQR (porque el general no es 5)", rqr == "t", rqr)

nombre, respuesta, esperados, cid, tel = creados[2]  # todo 5
filas = sql("SELECT COALESCE(semaforo::text,'null'), \"requiereRQR\" FROM \"SentimentAnalysis\" "
            "WHERE \"casoId\"='%s' ORDER BY \"analyzedAt\" DESC LIMIT 1;" % cid)
if filas:
    sem, rqr = filas[0].split("|")
    check("todo 5 -> VERDE y sin RQR", sem == "VERDE" and rqr == "f", filas[0])

print("")
print("=== 5. EL COMENTARIO QUEDA GUARDADO ===")
nombre, respuesta, esperados, cid, tel = creados[3]
filas = sql("SELECT item, comentario FROM \"EvaluacionPosventa\" WHERE \"casoId\"='%s' AND comentario IS NOT NULL;" % cid)
check("se guardo el comentario del cliente", len(filas) > 0, filas)
if filas:
    print("      " + filas[0])

print("")
print("=== 6. EL REPORTE DE DESEMPENO ===")
s, rep = call("GET", "/api/posventa/desempeno", tok)
check("responde", s == 200, s)
if s == 200:
    d = rep["data"]
    check("cuenta los clientes que contestaron", d["clientesQueContestaron"] == len(creados), d["clientesQueContestaron"])
    print("      clientes que contestaron: %d" % d["clientesQueContestaron"])
    print("      %-24s %-9s %-11s %s" % ("ITEM", "PROMEDIO", "RESPUESTAS", "% de 1 o 2"))
    for i in d["items"]:
        print("      %-24s %-9s %-11s %s" % (i["etiqueta"], i["promedio"], i["respuestas"], i["porcentajeMalos"]))
    check("el item mas flojo es el LAVADO", d["itemMasFlojo"] and d["itemMasFlojo"]["item"] == "LAVADO",
          d.get("itemMasFlojo"))
    check("hay corte por asesor", len(d["porAsesor"]) >= 2, len(d["porAsesor"]))
    check("hay comentarios", len(d["comentarios"]) >= 1, len(d["comentarios"]))
    check("hay detalle caso por caso", len(d["detalle"]) == len(creados), len(d["detalle"]))

print("")
print("=== 7. LAS EXPORTACIONES ===")
s, datos = call("GET", "/api/posventa/desempeno/excel", tok, crudo=True)
check("Excel se descarga", s == 200 and datos[:2] == b"PK" and len(datos) > 5000, "%s %d bytes" % (s, len(datos) if isinstance(datos, bytes) else 0))
s, datos = call("GET", "/api/posventa/desempeno/word", tok, crudo=True)
check("Word se descarga", s == 200 and datos[:2] == b"PK" and len(datos) > 5000, "%s %d bytes" % (s, len(datos) if isinstance(datos, bytes) else 0))

print("")
print("=== 8. EL FILTRO POR ASESOR FUNCIONA ===")
s, rep2 = call("GET", "/api/posventa/desempeno?asesor=Perez", tok)
if s == 200:
    check("filtrando por Perez quedan menos clientes", rep2["data"]["clientesQueContestaron"] == 2,
          rep2["data"]["clientesQueContestaron"])

# limpieza
for nombre, respuesta, esperados, cid, tel in creados:
    sql("DELETE FROM \"EvaluacionPosventa\" WHERE \"casoId\"='%s';" % cid)
    sql("DELETE FROM \"RQR\" WHERE \"casoId\"='%s';" % cid)
    sql("DELETE FROM \"SentimentAnalysis\" WHERE \"casoId\"='%s';" % cid)
    sql("DELETE FROM \"WhatsappMessage\" WHERE \"casoId\"='%s';" % cid)
    sql("DELETE FROM \"Caso\" WHERE id='%s';" % cid)

print("")
print("  %d bien / %d mal" % (ok, fail))
