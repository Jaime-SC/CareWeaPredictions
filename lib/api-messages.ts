export const EMPTY_MATCHES_MESSAGE =
  "No hay partidos de las ligas principales o copas oficiales programados para esta fecha. Intenta seleccionando un día con jornada de liga o copa.";

export const UEFA_NO_BIG5_MATCHUPS_MESSAGE =
  "No hay enfrentamientos entre clubes de 1ª división de Inglaterra, España o Italia para esta jornada UEFA.";

export const SA_CUP_NO_TOP2_MATCHUPS_MESSAGE =
  "No hay enfrentamientos entre equipos de Primera y Segunda División para esta fecha de Copa.";

export const EUROPE_CUP_NO_TOP2_MATCHUPS_MESSAGE =
  "No hay enfrentamientos entre equipos de 1ª y 2ª División para esta fecha de Copa.";

export const CONMEBOL_NO_ELIGIBLE_MATCHUPS_MESSAGE =
  "No hay enfrentamientos entre clubes de Primera División de Chile, Argentina o Brasil para esta fecha de CONMEBOL.";

export const CONCACAF_NO_ELIGIBLE_MATCHUPS_MESSAGE =
  "No hay enfrentamientos entre clubes de MLS o Liga MX para esta fecha de CONCACAF.";

export const API_CONNECTION_ERROR_MESSAGE =
  "Error al conectar con API-Football. Verifica tu API Key o el límite de peticiones diarias.";

export const API_KEY_MISSING_MESSAGE =
  "Falta FOOTBALL_API_KEY en el servidor. Añádela en .env.local y reinicia next dev.";

export const API_AUTH_MESSAGE =
  "API-Football rechazó la API Key. Confirma que FOOTBALL_API_KEY sea la misma del dashboard.";

export const API_RATE_LIMIT_MESSAGE =
  "API-Football bloqueó la consulta por exceso de peticiones por minuto. Espera unos segundos y vuelve a intentar. No es el cupo diario.";

export const API_IDS_UNSUPPORTED_MESSAGE =
  "API-Football rechazó /fixtures?ids= para esta clave. La app liquida por fecha (/fixtures?date=).";
