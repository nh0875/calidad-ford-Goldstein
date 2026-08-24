# -*- coding: utf-8 -*-
"""Los 4 arreglos que faltaban de la auditoria, probados contra el sistema real."""
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


def call(method, path, tok=None, body=None):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (FORD, path), method=method)
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


tok = call("POST", "/api/auth/login", body={"email": "admin@goldstein.com.ar", "password": "UqWuQnF5Zwf92bDT#4"})[1]["token"]
creados = []


_secuencia = [0]
_ultimoTel = [""]


def crear(orden, patente, area="POSVENTA", nombre=None, sucursal="Mendoza"):
    _secuencia[0] += 1
    tel = "+54926154%05d" % (10000 + _secuencia[0])
    _ultimoTel[0] = tel
    s, r = call("POST", "/api/casos", tok, {
        "numeroOrden": orden, "nombrePropietario": nombre or ("CLIENTE " + orden),
        "whatsapp": tel, "modelo": "Ranger", "patente": patente,
        "sucursal": sucursal, "asesor": "Prueba", "fechaProgramacion": "2026-08-21", "area": area})
    if s not in (200, 201):
        print("    no se pudo crear %s: %s" % (orden, r.get("message")))
        return None
    cid = r["data"]["id"]
    creados.append(cid)
    return cid


print("=== 12) LAS FECHAS DEL REPORTE, EN HORA ARGENTINA ===")
print("     Un cliente contesta el 21/08 a las 22:00. Antes se contaba en el 22.")
cid = crear("FECHA-01", "FE001AA")
if cid:
    # analisis a las 22:00 hora argentina del 21/08 = 01:00 UTC del 22/08
    sql("INSERT INTO \"SentimentAnalysis\" (id,\"casoId\",semaforo,confianza,\"resumenIA\",\"respuestaCrudaIA\","
        "\"esSeguimiento\",\"analyzedAt\") VALUES ('an-fecha-01','%s','VERDE',1,'prueba','{}',false,"
        "'2026-08-22T01:00:00Z');" % cid)
    s, rep = call("GET", "/api/reportes/sentimiento?fechaDesde=2026-08-21&fechaHasta=2026-08-21", tok)
    if s == 200:
        puntos = {p["fecha"]: p for p in rep["evolucion"]["puntos"]}
        check("entra al rango del 21", rep["totales"]["VERDE"] >= 1, rep["totales"])
        check("y se agrupa en el 21 (no en el 22)", "2026-08-21" in puntos, list(puntos.keys()))
        if "2026-08-22" in puntos:
            check("no aparece un balde del 22", False, "quedo un punto en 2026-08-22")
        else:
            check("no aparece un balde del 22", True)

print("")
print("=== 14) LOS RQR SIGUEN AL CASO CUANDO SE CORRIGE EL AREA ===")
cid2 = crear("AREA-01", "AR001AA", area="POSVENTA")
telArea = _ultimoTel[0]
if cid2:
    s, r = call("POST", "/api/rqr", tok, {
        "casoId": cid2, "canal": "Posventa", "areaOrigen": "Taller",
        "asesor": "Prueba", "descripcionReclamo": "reclamo de prueba"})
    check("se creo el RQR sobre el caso", s == 201, "%s %s" % (s, r.get("message")))
    filas = sql("SELECT area FROM \"RQR\" WHERE \"casoId\"='%s';" % cid2)
    check("el RQR nace en POSVENTA", filas and filas[0] == "POSVENTA", filas)

    # se corrige el area del caso
    s, casoActual = call("GET", "/api/casos/" + cid2, tok)
    d = casoActual.get("data", {})
    s, r = call("PATCH", "/api/casos/" + cid2, tok, {
        "numeroOrden": d.get("numeroOrden", "AREA-01"), "nombrePropietario": d.get("nombrePropietario", "X"),
        "fechaProgramacion": "2026-08-21", "origenAgendamiento": d.get("origenAgendamiento", "DEALER"),
        "asesor": "Prueba", "modelo": "Ranger", "patente": "AR001AA", "sucursal": "Mendoza",
        "whatsapp": telArea, "celular": "", "area": "VENTAS"})
    check("se pudo corregir el area del caso a VENTAS", s == 200, "%s %s" % (s, r.get("message")))
    filas = sql("SELECT area FROM \"RQR\" WHERE \"casoId\"='%s';" % cid2)
    check("el RQR se movio a VENTAS con el caso", filas and filas[0] == "VENTAS", filas)

print("")
print("=== 13) LA BUSQUEDA ENCUENTRA MAS ALLA DE LOS 500 MAS NUEVOS ===")
cid3 = crear("BUSQ-01", "BU001AA", nombre="ZZZAPATERO INENCONTRABLE")
if cid3:
    # se lo envejece: pasa a ser el caso MAS VIEJO de todos
    sql("UPDATE \"Caso\" SET \"createdAt\"='2020-01-01T00:00:00Z' WHERE id='%s';" % cid3)
    sql("INSERT INTO \"WhatsappMessage\" (id,\"casoId\",direction,content,status,\"createdAt\") "
        "VALUES ('msg-busq-01','%s','ENTRANTE','hola','recibido', now());" % cid3)
    s, lista = call("GET", "/api/seguimiento?q=ZZZAPATERO", tok)
    encontrados = [c for c in lista.get("data", []) if "ZZZAPATERO" in c["nombre"]]
    check("lo encuentra buscando por nombre", len(encontrados) == 1, "%s resultados" % len(lista.get("data", [])))
    s, lista = call("GET", "/api/seguimiento?q=BUSQ-01", tok)
    check("lo encuentra buscando por numero de orden", len(lista.get("data", [])) >= 1, lista.get("total"))

    print("     y los filtros de la pantalla siguen andando:")
    for filtro, nombre in [("todas", "Todas"), ("revision", "Para revisar"), ("rojos", "Rojos"), ("asesor", "Asesor")]:
        s, l = call("GET", "/api/seguimiento?filtro=" + filtro, tok)
        check("   filtro %-13s responde" % nombre, s == 200, s)
        if filtro == "rojos" and s == 200:
            malos = [c for c in l["data"] if c["semaforo"] not in (None, "ROJO")]
            check("   'Rojos' solo trae rojos", len(malos) == 0, [c["semaforo"] for c in malos[:3]])
        if filtro == "revision" and s == 200:
            malos = [c for c in l["data"] if not c["requiereRevision"]]
            check("   'Para revisar' solo trae los que lo piden", len(malos) == 0, len(malos))

print("")
print("=== 17) EL AGRADECIMIENTO NO SE MANDA DOS VECES ===")
filas = sql("SELECT count(*) FROM \"Caso\" c JOIN \"WhatsappMessage\" m ON m.\"casoId\"=c.id "
            "WHERE m.\"esAgradecimiento\"=true AND c.\"agradecimientoEnviadoEn\" IS NULL;")
check("no hay agradecimientos enviados sin su fecha (candado abierto)", filas and filas[0] == "0", filas)
filas = sql("SELECT c.\"numeroOrden\", count(*) FROM \"Caso\" c JOIN \"WhatsappMessage\" m ON m.\"casoId\"=c.id "
            "WHERE m.\"esAgradecimiento\"=true GROUP BY c.\"numeroOrden\" HAVING count(*) > 1;")
check("ningun caso tiene dos agradecimientos", len(filas) == 0, filas)

# limpieza
for c in creados:
    sql("DELETE FROM \"SentimentAnalysis\" WHERE \"casoId\"='%s';" % c)
    sql("DELETE FROM \"RQR\" WHERE \"casoId\"='%s';" % c)
    sql("DELETE FROM \"WhatsappMessage\" WHERE \"casoId\"='%s';" % c)
    sql("DELETE FROM \"Caso\" WHERE id='%s';" % c)

print("")
print("  %d bien / %d mal" % (ok, fail))
