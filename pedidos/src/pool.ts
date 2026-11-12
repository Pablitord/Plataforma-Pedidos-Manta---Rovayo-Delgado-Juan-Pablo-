
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

// Leer variables de entorno con valores por defecto
function enteroPositivo(
    valor: string | undefined,
    defecto: number
): number {
    const numero = Number(valor);

    return valor !== undefined &&
        Number.isSafeInteger(numero) &&
        numero > 0
        ? numero
        : defecto;
}

// Configuración del pool
const maxTrabajadores = enteroPositivo(
    process.env.MAX_TRABAJADORES,
    os.availableParallelism()
);

const maxCola = enteroPositivo(
    process.env.MAX_COLA,
    maxTrabajadores * 2
);

// Estructura de cada trabajo
interface Trabajo {
    n: number;
    resolve: (resultado: number) => void;
    reject: (error: Error) => void;
}

// Cola y contadores
const cola: Trabajo[] = [];

let activos = 0;
let rechazadas = 0;

// Consultar el estado del pool
export function estadoPool() {
    return {
        maxTrabajadores,
        activos,
        enCola: cola.length,
        maxCola,
        rechazadas
    };
}

// Ejecutar un trabajo en un Worker Thread
function ejecutar(trabajo: Trabajo): void {
    activos++;

    let worker: Worker;

    try {
        worker = new Worker(
            path.join(__dirname, "worker-reporte.js"),
            {
                workerData: { n: trabajo.n }
            }
        );
    } catch (error) {
        activos--;
        trabajo.reject(error as Error);
        despachar();
        return;
    }

    let resultado: number | undefined;
    let errorWorker: Error | undefined;

    worker.once("message", (valor: number) => {
        resultado = valor;
    });

    worker.once("error", (error: Error) => {
        errorWorker = error;
    });

    worker.once("exit", (codigo) => {
        activos--;

        if (errorWorker) {
            trabajo.reject(errorWorker);
        } else if (codigo !== 0 || resultado === undefined) {
            trabajo.reject(
                new Error(
                    `Worker terminó sin resultado (código ${codigo})`
                )
            );
        } else {
            trabajo.resolve(resultado);
        }

        // Despachar el siguiente trabajo pendiente
        despachar();
    });
}

// Despachador de trabajos
function despachar(): void {
    while (
        activos < maxTrabajadores &&
        cola.length > 0
    ) {
        ejecutar(cola.shift()!);
    }
}

// Función pública para solicitar un reporte
export function contarPrimosEnPool(n: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const trabajo: Trabajo = {
            n,
            resolve,
            reject
        };

        // Si hay un trabajador disponible, ejecutar
        if (activos < maxTrabajadores) {
            ejecutar(trabajo);
        }

        // Si todos están ocupados, agregar a la cola
        else if (cola.length < maxCola) {
            cola.push(trabajo);
        }

        // Si la cola está llena, rechazar
        else {
            rechazadas++;

            const error = new Error(
                "Pool lleno: no se aceptan más trabajos"
            );

            error.name = "PoolLleno";
            reject(error);
        }
    });
}
