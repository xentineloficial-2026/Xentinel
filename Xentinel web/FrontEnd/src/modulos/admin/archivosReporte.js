/** Genera PDF paginado, hojas .xlsx y CSV con valores de texto, nunca fórmulas. */
export async function generarPdf(reporte) {
  const [{ jsPDF: DocumentoPdf }, { autoTable: tablaPdf }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const documento = new DocumentoPdf({
    orientation: reporte.columnas.length > 5 ? 'landscape' : 'portrait',
  });
  documento.setProperties({ title: reporte.titulo, author: 'Xentinel' });
  documento.setFontSize(17);
  documento.text(reporte.titulo, 14, 16);
  documento.setFontSize(10);
  const subtitulo = documento.splitTextToSize(
    reporte.subtitulo,
    documento.internal.pageSize.width - 28
  );
  documento.text(subtitulo, 14, 23);
  tablaPdf(documento, {
    startY: 26 + subtitulo.length * 4,
    head: [reporte.columnas],
    body: reporte.filas,
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    headStyles: { fillColor: [20, 61, 124] },
    styles: { fontSize: 9, overflow: 'linebreak' },
  });
  return documento.output('blob');
}

export async function generarExcel(reporte) {
  const { default: Excel } = await import('exceljs/dist/exceljs.min.js');
  const libro = new Excel.Workbook();
  libro.creator = 'Xentinel';
  const hoja = libro.addWorksheet('Horarios', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  hoja.columns = reporte.columnas.map((header, indice) => ({
    header,
    width: [34, 15, 34, 16, 12, 12, 26, 28][indice] ?? 22,
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

export async function descargarReporte(reporte, formato) {
  const archivo =
    formato === 'pdf'
      ? await generarPdf(reporte)
      : formato === 'csv'
        ? generarCsv(reporte)
        : await generarExcel(reporte);
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(archivo);
  enlace.download = `${reporte.archivo}.${formato}`;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 30000);
}
