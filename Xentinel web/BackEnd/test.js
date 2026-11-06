import bcrypt from 'bcryptjs';

const clave = '1234';
const hashFresco = await bcrypt.hash(clave, 10);

console.log('--- COPIA ESTE HASH GENERADO ---');
console.log(hashFresco);

const coinciden = await bcrypt.compare(clave, hashFresco);
console.log('¿Validación local correcta?:', coinciden);