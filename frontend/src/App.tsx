import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Home } from './routes/Home';
import { ExecutiveApp } from './routes/executive/ExecutiveApp';
import { ClientApp } from './routes/client/ClientApp';
import { PreHandoverReportPage } from './routes/reports/PreHandoverReportPage';
import { NewHandoverReportPage } from './routes/reports/NewHandoverReportPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/executive" element={<ExecutiveApp />} />
        <Route path="/client" element={<ClientApp />} />
        <Route path="/report/pre/:preReportId" element={<PreHandoverReportPage />} />
        <Route path="/report/new/:contractId" element={<NewHandoverReportPage />} />
      </Routes>
    </BrowserRouter>
  );
}
