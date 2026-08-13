export const EMPTY_MATCHES_MESSAGE =
  "No hay partidos de las ligas principales o copas oficiales programados para esta fecha. Intenta seleccionando un día con jornada de liga o copa.";

export const API_CONNECTION_ERROR_MESSAGE =
  "Error al conectar con API-Football. Verifica tu API Key o el límite de peticiones diarias.";

export const API_KEY_MISSING_MESSAGE =
  "Falta FOOTBALL_API_KEY en el servidor. Añádela en .env.local y reinicia next dev.";

export const API_AUTH_MESSAGE =
  "API-Football rechazó la API Key. Confirma que FOOTBALL_API_KEY sea la misma del dashboard.";

export const API_RATE_LIMIT_MESSAGE =
  "API-Football bloqueó la consulta por exceso de peticiones por minuto (plan Free: 10/min). Espera ~1 minuto y vuelve a intentar. No es el cupo diario.";

export const API_IDS_UNSUPPORTED_MESSAGE =
  "Tu plan Free no permite /fixtures?ids=. La app liquida por fecha (/fixtures?date=), que sí está incluido.";
