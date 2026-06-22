import { Header } from '@/components/sections/Header';
import { Hero } from '@/components/sections/Hero';
import { ValueProps } from '@/components/sections/ValueProps';
import { Features } from '@/components/sections/Features';
import { Security } from '@/components/sections/Security';
import { Download } from '@/components/sections/Download';
import { Footer } from '@/components/sections/Footer';

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <ValueProps />
        <Features />
        <Security />
        <Download />
      </main>
      <Footer />
    </>
  );
}
