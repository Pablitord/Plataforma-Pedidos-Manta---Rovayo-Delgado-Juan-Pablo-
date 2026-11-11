
import { Request, Response, NextFunction } from "express";

const UMBRAL_LENTA_MS = Number(process.env.UMBRAL_LENTA_MS ?? 1000);

interface Estadistica {
    peticiones: number;
    totalMs: number;
    maxMs: number;
    lentas: number;
}

const porRuta = new Map<string, Estadistica>();

// Interceptor que mide cada petición
export function medirLatencia(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const inicio = performance.now();

    res.on("finish", () => {
        // TODO 1: calcula la duración en ms
        const ms = performance.now() - inicio;

        // TODO 2: busca la estadística de `${req.method} ${req.path}` (créala si no existe)
        const clave = `${req.method} ${req.path}`;

        const estadistica = porRuta.get(clave) ?? {
            peticiones: 0,
            totalMs: 0,
            maxMs: 0,
            lentas: 0
        };

        // TODO 3: actualiza peticiones, totalMs, maxMs y lentas (ms > UMBRAL_LENTA_MS)
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

// TODO 4: devuelve { umbralLentaMs, rutas: [{ ruta, peticiones, promedioMs, maxMs, lentas }] }
export function resumenMetricas() {
    return {
        umbralLentaMs: UMBRAL_LENTA_MS,
        rutas: [...porRuta].map(([ruta, e]) => ({
            ruta,
            peticiones: e.peticiones,
            promedioMs: Math.round(e.totalMs / e.peticiones),
            maxMs: Math.round(e.maxMs),
            lentas: e.lentas
        }))
    };
}
