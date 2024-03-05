export function cliTable(
  headers: string[],
  data: (string | number)[][]
): string {
  // ANSI escape code for green color
  const greenColor = "\x1b[32m";
  // ANSI escape code to reset color
  const resetColor = "\x1b[0m";

  // Calculate the width of each column
  const columnWidths: number[] = headers.map((header, index) =>
    Math.max(header.length, ...data.map((row) => String(row[index]).length))
  );

  // Build the top border
  const topBorder: string =
    "┌" + columnWidths.map((width) => "─".repeat(width)).join("┬") + "┐\n";

  // Build the header row
  const headerRow: string =
    "│" +
    headers
      .map((header, index) => header.padEnd(columnWidths[index]))
      .join("│") +
    "│\n";

  // Build the middle border
  const middleBorder: string =
    "├" + columnWidths.map((width) => "─".repeat(width)).join("┼") + "┤\n";

  // Build the data rows
  const dataRows: string = data
    .map(
      (row) =>
        greenColor +
        "│" +
        row
          .map((cell, index) => String(cell).padEnd(columnWidths[index]))
          .join("│") +
        "│" +
        resetColor +
        "\n"
    )
    .join("");

  // Build the bottom border
  const bottomBorder: string =
    "└" + columnWidths.map((width) => "─".repeat(width)).join("┴") + "┘";

  // Concatenate all parts to form the table
  const table: string =
    topBorder + headerRow + middleBorder + dataRows + bottomBorder;

  return table;
}
