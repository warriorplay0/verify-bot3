# Verify-Bot

## Iniciar el sitio

1. Instala Node.js 22.13 o posterior.
2. Ejecuta `npm install`.
3. En `.env.local`, pega tu clave de Groq en `GROQ_API_KEY` y tu clave de búsqueda web de Tavily en `TAVILY_API_KEY`. Son variables solo del servidor; no les pongas el prefijo `VITE_` ni compartas el archivo. Tavily ofrece una capa gratuita; crea la clave en `https://app.tavily.com/`. El texto de verificación se envía a Tavily como consulta de búsqueda.
4. Ejecuta `npm run dev` y abre la dirección que muestra Vite. El comando inicia la web y el backend local.

Las páginas disponibles son `/`, `/registro.html`, `/login.html` y `/verificar.html`. Después de iniciar sesión se abre el panel privado `/verificar.html`; al cerrar sesión o entrar sin autenticar, vuelve al inicio de sesión.

## Conectar Firebase

1. Crea un proyecto en Firebase y registra una aplicación web.
2. En Authentication, habilita el proveedor **Correo electrónico/contraseña**.
3. Usa la Realtime Database que ya creaste para el proyecto `verify-bot-46036`.
4. Habilita Firebase Storage para poder guardar los PDF.
5. La configuración de la aplicación web ya está en `.env.local` (archivo local ignorado por Git). Si necesitas regenerarlo, copia `.env.example` como `.env.local` y pega el `apiKey` que aparece en la consola de Firebase.
6. Reinicia `npm run dev` si cambias `.env.local`.
7. En Realtime Database, abre la pestaña **Reglas** y publica estas reglas (incluyen el formato de las respuestas de IA):

```json
{
  "rules": {
    "usuarios": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid && !data.exists() && newData.child('id_usuario').val() === auth.uid && newData.child('correo').val() === auth.token.email",
        ".validate": "newData.hasChildren(['id_usuario', 'nombre_completo', 'tipo_usuario', 'matricula', 'correo', 'nivel_estudios', 'area_ensenanza', 'fecha_registro'])",
        "id_usuario": {
          ".validate": "newData.isString() && newData.val() === auth.uid"
        },
        "nombre_completo": {
          ".validate": "newData.isString() && newData.val().length > 0"
        },
        "tipo_usuario": {
          ".validate": "newData.isString() && newData.val().length > 0"
        },
        "matricula": {
          ".validate": "newData.isString() && newData.val().length > 0"
        },
        "correo": {
          ".validate": "newData.isString() && newData.val() === auth.token.email"
        },
        "nivel_estudios": {
          ".validate": "newData.isString() && newData.val().length > 0"
        },
        "area_ensenanza": {
          ".validate": "newData.isString() && newData.val().length > 0"
        },
        "fecha_registro": {
          ".validate": "newData.isNumber()"
        },
        "$otro": {
          ".validate": false
        }
      }
    },
    "conversaciones": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid",
        "$conversationId": {
          ".validate": "newData.hasChildren(['titulo', 'creadaEn', 'actualizadaEn', 'mensajes'])",
          "titulo": {
            ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 120"
          },
          "creadaEn": {
            ".validate": "newData.isNumber()"
          },
          "actualizadaEn": {
            ".validate": "newData.isNumber()"
          },
          "mensajes": {
            "$messageId": {
              ".validate": "newData.hasChildren(['tipo', 'contenido', 'creadoEn']) && ((newData.child('tipo').val() === 'texto' && newData.child('contenido').isString() && newData.child('contenido').val().length <= 12000) || (newData.child('tipo').val() === 'url' && newData.child('contenido').isString() && newData.child('contenido').val().length <= 2048) || (newData.child('tipo').val() === 'pdf' && newData.child('contenido').isString() && newData.child('contenido').val().length <= 255 && newData.hasChildren(['archivoNombre', 'archivoRuta'])) || (newData.child('tipo').val() === 'respuesta' && newData.child('contenido').isString() && newData.child('contenido').val().length <= 12000 && newData.hasChildren(['proveedor', 'fuentes'])))",
              "tipo": {
                ".validate": "newData.isString() && (newData.val() === 'texto' || newData.val() === 'url' || newData.val() === 'pdf' || newData.val() === 'respuesta')"
              },
              "contenido": {
                ".validate": "newData.isString()"
              },
              "creadoEn": {
                ".validate": "newData.isNumber()"
              },
              "archivoNombre": {
                ".validate": "newData.isString() && newData.val().length <= 255"
              },
              "archivoRuta": {
                ".validate": "newData.isString() && newData.val().length <= 512"
              },
              "proveedor": {
                ".validate": "newData.isString() && newData.val() === 'Groq'"
              },
              "fuentes": {
                ".validate": "newData.isString() && newData.val().length <= 8000"
              },
              "$otro": {
                ".validate": false
              }
            }
          },
          "$otro": {
            ".validate": false
          }
        }
      }
    }
  }
}
```

Al registrarse, Firebase Authentication administra la contraseña y el perfil se guarda en `usuarios/{id_usuario}` de Realtime Database. El campo `fecha_registro` se genera automáticamente como timestamp del servidor. La contraseña nunca se escribe en la base de datos.

## Panel de verificación

Las conversaciones se guardan por usuario en `conversaciones/{uid}/{conversationId}` de Realtime Database. El texto y las URLs se guardan como mensajes. Los PDF se suben a `conversaciones/{uid}/{conversationId}/{messageId}/` en Firebase Storage (máximo 15 MB); Realtime Database conserva su ruta y nombre, nunca la URL de descarga. El usuario puede borrar cada conversación desde el historial.

Para guardar archivos, abre Firebase Storage → **Reglas** y publica:

```text
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /conversaciones/{uid}/{conversationId}/{messageId}/{fileName} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow create, update: if request.auth != null
        && request.auth.uid == uid
        && request.resource.size <= 15 * 1024 * 1024
        && request.resource.contentType == 'application/pdf';
      allow delete: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

El historial permanece guardado hasta que el usuario elimina la conversación. Groq es el único proveedor de IA; Tavily realiza búsquedas web y no genera respuestas. Los resultados se limitan a dominios seleccionados de organismos públicos, universidades, instituciones científicas y medios con estándares editoriales; el análisis cita los enlaces encontrados. Cada respuesta muestra un indicador verde para información respaldada, rojo para refutada y amarillo cuando la evidencia es parcial o insuficiente; el texto se presenta sin marcas Markdown crudas. Si no se encuentran fuentes suficientes, Verify-Bot lo indica en vez de inventar una verificación. Para PDF escaneados, Groq usa un modelo visual con OCR para analizar como imágenes las primeras tres páginas, en resolución reducida, y extraer una afirmación de búsqueda; un modelo de texto realiza el contraste final con la evidencia web para reducir el consumo de tokens visuales. Las URL se usan para orientar la búsqueda y no se descargan directamente. El backend valida la sesión de Firebase, limita el tamaño de las solicitudes y el ritmo de análisis. El proyecto local está listo para desarrollo; antes de publicarlo, despliega el backend detrás de HTTPS y configura las claves como secretos del servidor, nunca como variables `VITE_`.
