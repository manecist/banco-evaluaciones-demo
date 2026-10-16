# ✦ Guía: probar la integración con Moodle 4.5 ✦

Prueba de punta a punta entre el **Banco de Evaluaciones** y un **Moodle 4.5 real**: la prueba sale del banco, se rinde en Moodle y los resultados vuelven al banco para el análisis.

> [!NOTE]
> ✅ **Esta prueba ya se realizó el 16-10-2026** con un Moodle 4.5 real (ambiente QA en Google Cloud Run): 9 de 9 preguntas reconocidas y notas idénticas entre Moodle y el banco.
> [Ver el informe](docs/prueba-integracion-moodle/) · [descargar la evidencia (.zip)](docs/prueba-integracion-moodle/prueba-integracion-banco-moodle.zip)

> [!IMPORTANT]
> - Hágala en el ambiente **QA** del aula, no en Producción.
> - Use **solo usuarios de prueba con datos ficticios**.
> - No comparta claves ni el archivo de credenciales: el banco no necesita acceso a Moodle, solo los dos archivos que se intercambian.
>
> Tiempo estimado: unos **10 minutos**.

---

## 1. Sacar la prueba del banco

1. Abra el demo: https://manecist.github.io/banco-evaluaciones-demo/
2. Entre como **Paula Soto (docente)** → **Instrumentos** → **Prueba 1** → **Exportar a Moodle (XML)**.
3. Se descarga **`banco-moodle.xml`**.

## 2. Importar las preguntas en Moodle (QA)

1. Entre al aula **QA** con un usuario **administrador o profesor**.
2. Cree un curso de prueba, o use uno existente.
3. En el curso: **Más → Banco de preguntas → Importar**.
4. Formato: **Moodle XML** → suba `banco-moodle.xml` → **Importar** → **Continuar**.

Las preguntas quedan en categorías **carrera / módulo / resultado de aprendizaje**.

## 3. Crear el cuestionario

1. Active la edición → **Añadir una actividad o recurso** → **Cuestionario**.
2. Nombre: *Prueba 1 (demo banco)* → **Guardar y mostrar**.
3. **Preguntas** → **Agregar → del banco de preguntas**.
4. Elija la categoría importada, marque **todas** las preguntas → **Agregar preguntas seleccionadas al cuestionario**.

## 4. Responder con usuarios de prueba

1. Matricule **2 o 3 usuarios ficticios** como *Estudiante*.
2. Con cada uno, entre y **rinda el cuestionario**. Conviene equivocarse a propósito en algunas preguntas.
3. Moodle entrega la **nota al instante** al terminar.

## 5. Descargar el informe de respuestas

1. En el cuestionario: **Resultados → Respuestas**.
2. En las opciones del informe, marque **Texto de la pregunta** y **Respuesta**.
3. Abajo, en *Descargar datos de la tabla como*, elija **Valores separados por comas (.csv)** → **Descargar**.

## 6. Traer los resultados al banco

1. En el demo, como Paula → **Instrumentos** → **Prueba 1** → **Importar resultados de Moodle**.
2. **Subir CSV de Moodle** → elija el archivo descargado.
3. Revise:
   - Que diga cuántas **preguntas reconoció** (debería reconocer todas las de selección múltiple y verdadero o falso).
   - Que la columna **«Calificación en Moodle»** coincida con el **«Puntaje»** recalculado por el banco.
   - Que no aparezcan nombres ni correos: solo **códigos anónimos**.
4. **Guardar resultados y actualizar el análisis** → abra **Análisis de ítems**.

## 7. Si algo no calza

Envíe el **CSV descargado de Moodle** (solo tiene usuarios ficticios) a quien mantiene el demo. Con ese archivo real se ajusta el lector.

---

### Qué demuestra esta prueba

| Paso | Dónde | Qué pasa |
|---|---|---|
| ✍️ Preparar | Banco | La prueba se arma con preguntas revisadas y aprobadas |
| 📤 Enviar | Banco → Moodle | Moodle importa el XML: preguntas, puntajes, claves y retroalimentación |
| 💻 Rendir | Moodle | Los estudiantes responden en el Aula Virtual y reciben su nota al instante |
| 📥 Volver | Moodle → Banco | El informe de respuestas vuelve **sin datos personales** |
| 📊 Mejorar | Banco | El análisis detecta preguntas difíciles, confusas o con la clave equivocada |

<sub>Las preguntas de verdadero o falso se reconocen mejor si el informe incluye el «Texto de la pregunta». Las de respuesta breve, términos pareados y desarrollo se corrigen en Moodle y no entran al cálculo automático del banco.</sub>
