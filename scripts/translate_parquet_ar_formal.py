#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
from typing import Any
from urllib import error, request

import pyarrow as pa
import pyarrow.parquet as pq


SYSTEM_PROMPT = (
    "Sos un traductor experto en conversaciones comerciales. "
    "Traducí al espanol argentino formal (tono profesional y claro). "
    "Mantené intacta la estructura original del texto, etiquetas, saltos de linea, "
    "tokens especiales y formato. "
    "Si aparecen etiquetas como 'Customer:' y 'Salesman:', traducilas consistentemente "
    "a 'Cliente:' y 'Asesor:'. "
    "No agregues informacion nueva ni resumenes."
)


def call_chat_completion(
    api_key: str,
    model: str,
    text: str,
    api_base: str,
    temperature: float = 0.1,
    max_retries: int = 5,
) -> str:
    payload: dict[str, Any] = {
        "model": model,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
    }

    body = json.dumps(payload).encode("utf-8")
    endpoint = api_base.rstrip("/") + "/chat/completions"

    for attempt in range(1, max_retries + 1):
        req = request.Request(
            endpoint,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"]
        except error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="ignore")
            if attempt == max_retries:
                raise RuntimeError(f"HTTP {exc.code}: {details}") from exc
        except Exception as exc:
            if attempt == max_retries:
                raise RuntimeError(f"Error llamando API: {exc}") from exc

        sleep_seconds = min(2 ** attempt, 20)
        time.sleep(sleep_seconds)

    raise RuntimeError("No se pudo traducir tras varios reintentos.")


def write_output(table: pa.Table, column_name: str, translated: list[str], output_path: str) -> None:
    out_columns = []
    for name in table.column_names:
        if name == column_name:
            out_columns.append(pa.array(translated, type=pa.string()))
        else:
            out_columns.append(table[name])
    out_table = pa.table(out_columns, names=table.column_names)
    pq.write_table(out_table, output_path, compression="zstd")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Traduce un parquet de conversaciones a espanol argentino formal."
    )
    parser.add_argument("--input", required=True, help="Ruta del parquet de entrada")
    parser.add_argument("--output", required=True, help="Ruta del parquet de salida")
    parser.add_argument("--column", default="0", help="Columna de texto a traducir")
    parser.add_argument("--limit", type=int, default=0, help="Cantidad de filas a procesar (0=todas)")
    parser.add_argument("--offset", type=int, default=0, help="Fila inicial para procesar")
    parser.add_argument("--model", default=os.getenv("TRANSLATION_MODEL", "gpt-4o-mini"))
    parser.add_argument("--api-base", default=os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1"))
    parser.add_argument("--sleep-ms", type=int, default=50, help="Pausa entre filas para evitar rate limits")
    parser.add_argument(
        "--save-every",
        type=int,
        default=25,
        help="Guarda progreso cada N traducciones (tambien guarda al presionar Ctrl+C)",
    )
    args = parser.parse_args()

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        print("Falta OPENAI_API_KEY en el entorno.", file=sys.stderr)
        return 1

    table = pq.read_table(args.input)
    if args.column not in table.column_names:
        print(
            f"Columna '{args.column}' no existe. Columnas: {table.column_names}",
            file=sys.stderr,
        )
        return 1

    records = table.column(args.column).to_pylist()
    total = len(records)
    start = max(args.offset, 0)
    end = total if args.limit <= 0 else min(total, start + args.limit)

    if start >= end:
        print(f"Rango vacio (start={start}, end={end}, total={total}).", file=sys.stderr)
        return 1

    translated = records[:]
    if os.path.exists(args.output):
        try:
            existing_table = pq.read_table(args.output)
            if args.column in existing_table.column_names and existing_table.num_rows == total:
                translated = existing_table.column(args.column).to_pylist()
                print(f"Reanudando desde salida existente: {args.output}")
            else:
                print("Salida existente incompatible, se ignora para reanudar.")
        except Exception as exc:
            print(f"No se pudo usar salida existente para reanudar: {exc}")

    print(f"Procesando filas {start}..{end - 1} de {total}...")
    translated_in_run = 0

    try:
        for idx in range(start, end):
            source_text = records[idx]
            if not isinstance(source_text, str) or not source_text.strip():
                continue

            already_translated = isinstance(translated[idx], str) and translated[idx].strip() and translated[idx] != source_text
            if already_translated:
                continue

            translated[idx] = call_chat_completion(
                api_key=api_key,
                model=args.model,
                text=source_text,
                api_base=args.api_base,
            )
            translated_in_run += 1

            if translated_in_run % 50 == 0:
                print(f"Traducidas en esta corrida: {translated_in_run} filas...")

            if args.save_every > 0 and translated_in_run % args.save_every == 0:
                write_output(table, args.column, translated, args.output)
                print(f"Checkpoint guardado ({translated_in_run} nuevas).")

            if args.sleep_ms > 0:
                time.sleep(args.sleep_ms / 1000.0)
    except KeyboardInterrupt:
        write_output(table, args.column, translated, args.output)
        print("\nInterrumpido por usuario. Progreso parcial guardado.")
        return 130

    write_output(table, args.column, translated, args.output)
    print(f"Listo. Archivo generado: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
