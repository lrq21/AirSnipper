# Air Cleaner — Setup

Bot de consola para limpiar un servidor de Discord. Opciones:

1. **Kick Members** — kickea a todas las cuentas (member, staff, admin…) excepto al dueño y a los bots/apps
2. **Remove Catg & Channels** — borra todas las categorías y canales
3. **Remove All Roles** — borra todos los roles que el bot pueda borrar

Cada opción pide escribir el nombre exacto del servidor antes de ejecutarse.

---

## 1. Requisitos

- [Node.js 18 o superior](https://nodejs.org) (el instalador LTS sirve)

## 2. Crear el bot

1. Entra a https://discord.com/developers/applications → **New Application**
2. Menú **Bot** → **Reset Token** → copia el token (no lo compartas con nadie)
3. En esa misma página, baja a **Privileged Gateway Intents** y activa:
   - ✅ **SERVER MEMBERS INTENT** (obligatorio, sin esto no puede listar ni kickear miembros)
4. Guarda los cambios

## 3. Invitar el bot al servidor

Menú **OAuth2 → URL Generator**:
- Scopes: `bot`
- Bot Permissions, la forma fácil: **Administrator**

Si prefieres no dar Administrator, marca solo estos tres:
- **Kick Members**
- **Manage Channels**
- **Manage Roles**

Copia el link generado, ábrelo y añade el bot a tu servidor.

## 4. Ajustes dentro del servidor (importante)

1. **Ajustes del servidor → Roles**: arrastra el rol del bot hasta **arriba de todos** los demás.
   Si queda debajo de un rol (por ejemplo `admin` o `staff`), no podrá kickear a quienes lo tengan ni borrar ese rol.
2. Si el servidor tiene **Comunidad** activada, desactívala: **Ajustes del servidor → Comunidad → Desactivar**.
   Si no, Discord no deja borrar los canales de reglas y actualizaciones.

## 5. Configurar y correr

En la carpeta del proyecto, copia `.env.example` como `.env` y pega el token:

```
TOKEN=tu_token_aqui
GUILD_ID=
```

`GUILD_ID` es opcional. Si lo dejas vacío y el bot está en varios servidores, te deja elegir en la consola.

Luego en CMD, dentro de la carpeta:

```
npm install
node index.js
```

(`npm install` solo se hace la primera vez. También puedes hacer doble clic en `start.bat`.)

## Notas

- El dueño del servidor nunca se kickea (Discord no lo permite).
- Los bots/apps del servidor se saltan en el kick, y los roles de bots/integraciones no se pueden borrar.
- Los tiempos dependen de cuántas cuentas, canales o roles haya: el bot va con una pausa de ~0.4 s por acción para no chocar con los rate limits.
- Orden recomendado: **1 → 2 → 3**.
- Todo es irreversible. Úsalo solo en servidores tuyos.
