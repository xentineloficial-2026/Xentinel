// Configuración centralizada de la API.
// Todos los componentes y servicios deben importar URL_API desde aquí
// en vez de repetir la dirección.
const URL_API = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '');
export { URL_API };
