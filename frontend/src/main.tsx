import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { LangProvider } from './lib/i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './styles/global.css'
import { AuthProvider } from './lib/auth'
import { RouteFallback } from './components/RouteFallback'

// Every route is its own chunk: the landing page never downloads the workspace, and vice versa.
const Landing = lazy(() => import('./routes/Landing'))
const SignIn = lazy(() => import('./routes/SignIn'))
const Workspace = lazy(() => import('./app/Workspace'))
const Ask = lazy(() => import('./app/Ask'))
const Library = lazy(() => import('./app/Library'))
const Alerts = lazy(() => import('./app/Alerts'))
const SharedView = lazy(() => import('./routes/SharedView'))
const VerifyReport = lazy(() => import('./routes/VerifyReport'))
const NotFound = lazy(() => import('./routes/NotFound'))

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
})

const s = (el: React.ReactNode) => <Suspense fallback={<RouteFallback />}>{el}</Suspense>

const router = createBrowserRouter([
  { path: '/', element: s(<Landing />) },
  { path: '/sign-in', element: s(<SignIn />) },
  { path: '/s/:token', element: s(<SharedView />) },
  { path: '/verify', element: s(<VerifyReport />) },
  { path: '/verify/:id', element: s(<VerifyReport />) },
  {
    path: '/app',
    element: s(<Workspace />),
    children: [
      { index: true, element: s(<Ask />) },
      { path: 'c/:chatId', element: s(<Ask />) },
      { path: 'library', element: s(<Library />) },
      { path: 'library/:docId', element: s(<Library />) },
      { path: 'alerts', element: s(<Alerts />) },
    ],
  },
  { path: '*', element: s(<NotFound />) },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LangProvider>

        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>

      </LangProvider>
    </QueryClientProvider>
  </StrictMode>,
)
