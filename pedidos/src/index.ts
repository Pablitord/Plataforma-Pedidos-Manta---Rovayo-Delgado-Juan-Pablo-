import express, { Request, Response } from 'express';
import {randomUUID} from "node:crypto"; //Generar Valores Aleatorios
import {contarPrimos} from "./calculo"; //Importar la función contarPrimos desde calculo.ts
import {Worker} from "node:worker_threads"; //Importar la clase Worker para crear hilos de trabajo
import path from "node:path"; //Importar el módulo path para manejar rutas de archivos
import { medirLatencia, resumenMetricas } from "./metricas";
import { contarPrimosEnPool, estadoPool } from "./pool";
import {llamar, aHTTP} from "./inventario-grpc"; //Importar la función llamar desde inventario-grpc.ts


const PORT = Number(process.env.PORT ?? 3000);
const INVENTARIO_URL = process.env.INVENTARIO_URL ?? "http://localhost:3001";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 2000);
const REPORTE_N = Number(process.env.REPORTE_N ?? 8_000_000); //Número de primos a contar para el reporte

interface Pedido{
    id: string;
    sku: string;
    cantidad: number;
    creadoEn: string,
}
const pedidos : Pedido[] = [];


const app = express();
app.use(express.json());
app.use(medirLatencia);

//Salud Server
app.get("/health", (_req: Request, res: Response) =>{
    res.json({ status: "OK" , servicio: "pedidos"});
});

// Readiness: comprobar disponibilidad de Inventario
app.get("/health/ready", async (_req: Request, res: Response) => {
    const inicio = performance.now();

    try {
        const respuesta = await fetch(`${INVENTARIO_URL}/health`, {
            signal: AbortSignal.timeout(1000)
        });

        const ms = Math.round(performance.now() - inicio);

        if (!respuesta.ok) {
            res.status(503).json({
                status: "no-listo",
                inventario: `HTTP ${respuesta.status}`,
                ms
            });
            return;
        }

        res.status(200).json({
            status: "listo",
            inventario: "ok",
            ms
        });

    } catch (error) {
        const ms = Math.round(performance.now() - inicio);
        const e = error as Error;

        const motivo = e.name === "TimeoutError"
            ? "Tiempo de espera agotado"
            : `No se pudo conectar: ${e.message}`;

        res.status(503).json({
            status: "no-listo",
            inventario: motivo,
            ms
        });
    }
});

app.get("/pedidos", (_req: Request, res: Response) =>{
    res.json(pedidos);
});



app.post("/pedidos", async (req: Request, res: Response) => {
    const { sku, cantidad } = req.body ?? {};

    // Validar los datos recibidos
    if (
        typeof sku !== "string" ||
        !Number.isInteger(cantidad) ||
        cantidad <= 0
    ) {
        res.status(400).json({
            error: "Se requiere un SKU y una cantidad entera positiva"
        });
        return;
    }

    const inicio = performance.now();

    try {
        // Reservar stock mediante gRPC
        const reserva = await llamar<{
            sku: string;
            reservado: number;
            restante: number;
        }>("reservar", { sku, cantidad });

        // Registrar el pedido si la reserva fue exitosa
        const pedido: Pedido = {
            id: randomUUID(),
            sku,
            cantidad,
            creadoEn: new Date().toISOString()
        };

        pedidos.push(pedido);

        res.status(201).json(pedido);

    } catch (error) {
        const duracionMs = Math.round(
            performance.now() - inicio
        );

        const { status, cuerpo } = aHTTP(error);

        console.error(
            "[pedidos] " + cuerpo.error + " " + cuerpo.motivo
        );

        res.status(status).json({
            ...cuerpo,
            duracionMs
        });
    }
});



//Función Leer Primos
function leerN(req: Request): number {
    const n = Number(req.query.n ?? REPORTE_N);
    return Number.isInteger(n) && n> 0 && n <= 50_000_000 ? n : REPORTE_N;
};

app.get("/reporte/bloqueante", (req: Request, res: Response) => {
    const n = leerN(req);
    const inicio = performance.now();
    const primos = contarPrimos(n);
    const duracionMs = Math.round(performance.now() - inicio);
    res.json({modo: "bloqueando", n, primos, duracionMs})
});

 // Con el hilo del worker
function contarPrimosenWorker(n: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const archivo = path.join(__dirname, "worker-reporte.js");
        const w = new Worker(archivo, { workerData: { n } });

        w.once("message", (primos: number) => resolve(primos));
        w.once("error", reject);
    });
}

app.get("/reporte/worker", async (req: Request, res: Response) => {
    const n = leerN(req);
    const inicio = performance.now();
    const primos = await contarPrimosenWorker(n);
    const duracionMs = Math.round(performance.now() - inicio);
    res.json({modo: "worker", n, primos, duracionMs})
});



// Reporte con Pool de trabajadores limitado
app.get("/reporte/pool", async ( req: Request, res: Response) => {
    const n = leerN(req);
    const inicio = performance.now();
    try {
        const primos = await contarPrimosEnPool(n);
        const duracionMs = Math.round(
            performance.now() - inicio
        );
        res.json({modo: "pool", n, primos, duracionMs
        });
    } catch (error) {
        const e = error as Error;
        if (e.name === "PoolLleno") {
            res.setHeader("Retry-After", "1");
            res.status(503).json({ error: e.message, pool: estadoPool()
            });
            return;
        }
        console.error("Error en /reporte/pool:",e
        );
        res.status(500).json({error: "No se pudo ejecutar el reporte"});
    }
});

// Resumen de métricas y estado del pool
app.get("/metricas", ( _req: Request, res: Response ) => {
    res.json({...resumenMetricas(), pool: estadoPool() });
});

//Puerto en el que escucha
app.listen(PORT, () => {
    console.log(`Servicio de pedidos escuchando en el puerto: ${PORT} ` + `Inventario: ${INVENTARIO_URL}` + ` Timeout: ${TIMEOUT_MS} ms`);
});

