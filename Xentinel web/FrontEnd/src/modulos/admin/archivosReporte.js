/** Genera reportes en Excel (.xlsx), CSV y PDF con valores de texto, nunca fórmulas. */

/** Ancho de cada columna según su contenido, entre 10 y 42 caracteres. */
function anchos(reporte) {
  return reporte.columnas.map((titulo, indice) =>
    Math.min(
      42,
      Math.max(
        10,
        String(titulo).length + 2,
        ...reporte.filas
          .slice(0, 500)
          .map((fila) => String(fila[indice] ?? '').length + 2)
      )
    )
  );
}

export async function generarExcel(reporte) {
  const { default: Excel } = await import('exceljs/dist/exceljs.min.js');
  const libro = new Excel.Workbook();
  libro.creator = 'Xentinel';
  const hoja = libro.addWorksheet(reporte.hoja || 'Reporte', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const medidas = anchos(reporte);
  hoja.columns = reporte.columnas.map((header, indice) => ({
    header,
    width: medidas[indice],
  }));
  hoja.addRows(reporte.filas);
  hoja.getRow(1).font = { bold: true };
  hoja.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: reporte.columnas.length },
  };
  return new Blob([await libro.xlsx.writeBuffer()], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Excel en español abre bien `;` con BOM. Un apóstrofo evita que un valor se ejecute como fórmula. */
function celdaCsv(valor) {
  let texto = String(valor ?? '');
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function generarCsv(reporte) {
  const lineas = [reporte.columnas, ...reporte.filas].map((fila) =>
    fila.map(celdaCsv).join(';')
  );
  return new Blob([`\uFEFF${lineas.join('\r\n')}\r\n`], {
    type: 'text/csv;charset=utf-8',
  });
}

/** PDF horizontal para imprimir o archivar: título, periodo, tabla y numeración de páginas. */
export async function generarPdf(reporte) {
  const [{ jsPDF: Pdf }, { autoTable: tabla }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const documento = new Pdf({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });
  const margen = 36;
  const generado = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date());
  documento.setProperties({ title: reporte.titulo, creator: 'Xentinel' });
  documento.setFont('helvetica', 'bold');
  documento.setFontSize(15);
  documento.setTextColor(17, 33, 45);
  documento.text(reporte.titulo, margen, margen + 6);
  documento.setFont('helvetica', 'normal');
  documento.setFontSize(9.5);
  documento.setTextColor(74, 92, 106);
  documento.text(reporte.subtitulo ?? '', margen, margen + 22);
  const columnas = reporte.columnas.length;
  tabla(documento, {
    head: [reporte.columnas],
    body: reporte.filas.map((fila) => fila.map((valor) => String(valor ?? ''))),
    startY: margen + 34,
    margin: { left: margen, right: margen, bottom: margen + 10 },
    styles: {
      font: 'helvetica',
      fontSize: columnas > 10 ? 7 : 8,
      cellPadding: 3.5,
      textColor: [6, 20, 27],
      lineColor: [204, 208, 207],
      lineWidth: 0.4,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [17, 33, 45],
      textColor: [242, 244, 243],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [238, 241, 240] },
    didDrawPage: () => {
      const alto = documento.internal.pageSize.getHeight();
      const ancho = documento.internal.pageSize.getWidth();
      documento.setFontSize(8);
      documento.setTextColor(74, 92, 106);
      documento.text(
        `Xentinel · SENA Fontibón · Generado ${generado}`,
        margen,
        alto - 18
      );
      documento.text(
        `Página ${documento.getCurrentPageInfo().pageNumber}`,
        ancho - margen,
        alto - 18,
        { align: 'right' }
      );
    },
  });
  return documento.output('blob');
}

const GENERADORES = { csv: generarCsv, xlsx: generarExcel, pdf: generarPdf };

export async function descargarReporte(reporte, formato) {
  const generar = GENERADORES[formato] ?? generarExcel;
  const archivo = await generar(reporte);
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(archivo);
  enlace.download = `${reporte.archivo}.${GENERADORES[formato] ? formato : 'xlsx'}`;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 30000);
}
