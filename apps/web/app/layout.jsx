import '../src/styles.css';

export const metadata = {
  title: 'DataScrap',
  description: 'Dashboard de vagas e insights do projeto DataScrap',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
