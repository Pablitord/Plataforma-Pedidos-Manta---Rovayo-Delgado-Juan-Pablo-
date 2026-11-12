
import { monitorEventLoopDelay } from "node:perf_hooks";
import os from "node:os";
import { Request, Response, NextFunction } from "express";

const UMBRAL_LENTA_MS = Number(process.env.UMBRAL_LENTA_MS ?? 1000);

interface Estadistica {
    peticiones: number;
    totalMs: number;
    maxMs: number;
    lentas: number;
}

const porRuta = new Map<string, Estadistica>();

// Medir el retardo del bucle de eventos
const retardoBucle = monitorEventLoopDelay({ resolution: 10 });
retardoBucle.enable();

// Convertir nanosegundos a milisegundos
function aMilisegundos(ns: number): number {
    return Math.round(ns / 1e6);
}

// Interceptor que mide cada petición
export function medirLatencia(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const inicio = performance.now();

    res.on("finish", () => {
        const ms = performance.now() - inicio;
        const clave = `${req.method} ${req.path}`;

        const estadistica = porRuta.get(clave) ?? {
            peticiones: 0,
            totalMs: 0,
            maxMs: 0,
            lentas: 0
        };

        estadistica.peticiones++;
        estadistica.totalMs += ms;
        estadistica.maxMs = Math.max(estadistica.maxMs, ms);

        if (ms > UMBRAL_LENTA_MS) {
            estadistica.lentas++;
        }

        porRuta.set(clave, estadistica);
    });

    next();
}

// Resumen de métricas
export function resumenMetricas() {
    return {
        umbralLentaMs: UMBRAL_LENTA_MS,
        nucleos: os.availableParallelism(),

        bucle: {
            p50Ms: aMilisegundos(retardoBucle.percentile(50)),
            p99Ms: aMilisegundos(retardoBucle.percentile(99)),
            maxMs: aMilisegundos(retardoBucle.max)
        },

        rutas: [...porRuta].map(([ruta, e]) => ({
            ruta,
            peticiones: e.peticiones,
            promedioMs: Math.round(e.totalMs / e.peticiones),
            maxMs: Math.round(e.maxMs),
            lentas: e.lentas
        }))
    };
}
