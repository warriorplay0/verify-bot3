import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { ref, serverTimestamp, set } from "firebase/database";
import { auth, db, isFirebaseConfigured } from "./firebase.js";

const registrationForm = document.querySelector("#registro-form");
const loginForm = document.querySelector("#login-form");

if (loginForm && auth) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      window.location.replace("/verificar.html");
    }
  });
}

function showStatus(element, message, kind = "error") {
  element.textContent = message;
  element.dataset.kind = kind;
}

function firebaseErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "Ya existe una cuenta con ese correo.",
    "auth/invalid-email": "Escribe un correo electrónico válido.",
    "auth/invalid-credential": "El correo o la contraseña no son correctos.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/network-request-failed": "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.",
    "auth/configuration-not-found": "Firebase Authentication no está configurado. Activa el proveedor Correo electrónico/contraseña en Firebase.",
    "auth/operation-not-allowed": "Activa el proveedor Correo electrónico/contraseña en Firebase Authentication para permitir el registro.",
    PERMISSION_DENIED: "Firebase rechazó el guardado. Revisa las reglas de Realtime Database.",
  };
  return messages[error.code] ?? `No se pudo completar la operación: ${error.message}`;
}

if (registrationForm) {
  registrationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#registro-status");
    const submitButton = registrationForm.querySelector('button[type="submit"]');
    const formData = new FormData(registrationForm);
    const correo = formData.get("correo").trim();

    if (!isFirebaseConfigured) {
      showStatus(status, "Firebase aún no está configurado. Copia .env.example a .env.local y completa los datos de tu proyecto.");
      return;
    }

    submitButton.disabled = true;
    showStatus(status, "Creando tu cuenta…", "loading");

    try {
      const { user } = await createUserWithEmailAndPassword(auth, correo, formData.get("contrasena"));
      try {
        await set(ref(db, `usuarios/${user.uid}`), {
          id_usuario: user.uid,
          nombre_completo: formData.get("nombre_completo").trim(),
          tipo_usuario: formData.get("tipo_usuario").trim(),
          matricula: formData.get("matricula").trim(),
          correo: user.email,
          nivel_estudios: formData.get("nivel_estudios").trim(),
          area_ensenanza: formData.get("area_ensenanza").trim(),
          fecha_registro: serverTimestamp(),
        });
      } catch (error) {
        try {
          await deleteUser(user);
        } catch (cleanupError) {
          throw new Error(
            `La cuenta se creó, pero no se pudo guardar el perfil (${error.message}) ni cancelar el registro (${cleanupError.message}).`,
          );
        }
        throw error;
      }

      registrationForm.reset();
      showStatus(status, "¡Tu cuenta está lista! Ya puedes iniciar sesión.", "success");
    } catch (error) {
      showStatus(status, firebaseErrorMessage(error));
    } finally {
      submitButton.disabled = false;
    }
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#login-status");
    const submitButton = loginForm.querySelector('button[type="submit"]');
    const formData = new FormData(loginForm);

    if (!isFirebaseConfigured) {
      showStatus(status, "Firebase aún no está configurado. Copia .env.example a .env.local y completa los datos de tu proyecto.");
      return;
    }

    submitButton.disabled = true;
    showStatus(status, "Verificando tus datos…", "loading");

    try {
      await signInWithEmailAndPassword(auth, formData.get("correo").trim(), formData.get("contrasena"));
      loginForm.reset();
      window.location.assign("/verificar.html");
    } catch (error) {
      showStatus(status, firebaseErrorMessage(error));
    } finally {
      submitButton.disabled = false;
    }
  });
}
