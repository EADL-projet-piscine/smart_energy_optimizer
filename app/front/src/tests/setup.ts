import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Démonte les composants entre deux tests : sans cela, les rendus s'empilent
// dans le même document et les requêtes trouvent plusieurs éléments.
afterEach(cleanup)
