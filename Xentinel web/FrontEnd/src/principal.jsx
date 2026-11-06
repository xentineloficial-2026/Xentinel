/** Inicializa React, el enrutador y la preferencia global de tema. */
import React from 'react';
import DOMReact from 'react-dom/client';
import { BrowserRouter as EnrutadorNavegador } from 'react-router-dom';
import Aplicacion from './Aplicacion.jsx';
import './estilos/base.css';
import './modulos/publico/publico.css';
import { ProveedorTema } from './compartido/contextos/ProveedorTema.jsx';
DOMReact.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <EnrutadorNavegador>
      <ProveedorTema>
        <Aplicacion />
      </ProveedorTema>
    </EnrutadorNavegador>
  </React.StrictMode>
);
