"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import { LANDING_HTML } from "./landing-markup";
import "./landing.css";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

// Renders the approved landing markup and wires its interactions; everything is torn down on unmount.
export function Landing({ signedIn }: { signedIn: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const html = signedIn
    ? LANDING_HTML.replace('<a href="/login" data-auth-link style="font-weight:600">Log in</a>', '<a href="/dashboard" data-auth-link style="font-weight:600">Go to dashboard</a>')
    : LANDING_HTML;

  useGSAP(
    () => {
      const el = root.current!;
      const q = <T extends Element = HTMLElement>(s: string) => [...el.querySelectorAll<T>(s)] as T[];
      const one = <T extends Element = HTMLElement>(s: string) => el.querySelector<T>(s)!;
      const off: (() => void)[] = [];
      const on = (t: EventTarget, ev: string, fn: EventListener) => {
        t.addEventListener(ev, fn);
        off.push(() => t.removeEventListener(ev, fn));
      };

      // Scroll reveal and stat counters.
      const countUp = (n: HTMLElement) => {
        if (n.dataset.done) return;
        n.dataset.done = "1";
        const to = parseFloat(n.dataset.count!), dec = +(n.dataset.dec || 0), t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / 1600);
          n.textContent = (to * (1 - Math.pow(1 - p, 4))).toFixed(dec);
          if (p < 1) requestAnimationFrame(tick);
        };
        tick(t0);
      };
      const io = new IntersectionObserver(
        (es) =>
          es.forEach((e) => {
            if (!e.isIntersecting) return;
            e.target.classList.add("in");
            e.target.querySelectorAll(".stat").forEach((s) => s.classList.add("in"));
            e.target.querySelectorAll<HTMLElement>("[data-count]").forEach(countUp);
            io.unobserve(e.target);
          }),
        { threshold: 0.15 },
      );
      q(".rv").forEach((n) => io.observe(n));
      off.push(() => io.disconnect());

      // Pricing toggle.
      q<HTMLButtonElement>(".toggle button").forEach((b) =>
        on(b, "click", () => {
          q(".toggle button").forEach((x) => x.classList.toggle("on", x === b));
          q<HTMLElement>(".pp").forEach((p) => (p.textContent = "$" + p.dataset[b.dataset.p!]));
        }),
      );

      // Try-it signature pad.
      const cv = one<HTMLCanvasElement>("#cv"), hint = one("#hint"), toast = one("#toast");
      const ctx = cv.getContext("2d")!;
      const size = () => {
        const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
        cv.width = r.width * d;
        cv.height = r.height * d;
        ctx.scale(d, d);
        Object.assign(ctx, { lineWidth: 3.2, lineCap: "round", lineJoin: "round", strokeStyle: "#000" });
      };
      size();
      on(window, "resize", size);
      let drawing = false, inked = false, last = { x: 0, y: 0 };
      const pos = (e: PointerEvent) => {
        const r = cv.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      on(cv, "pointerdown", ((e: PointerEvent) => {
        drawing = true;
        last = pos(e);
        cv.setPointerCapture(e.pointerId);
        hint.style.opacity = "0";
      }) as EventListener);
      on(cv, "pointermove", ((e: PointerEvent) => {
        if (!drawing) return;
        const p = pos(e);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        last = p;
        inked = true;
      }) as EventListener);
      on(cv, "pointerup", () => (drawing = false));
      on(one("#clr"), "click", () => {
        ctx.clearRect(0, 0, cv.width, cv.height);
        hint.style.opacity = ".12";
        inked = false;
        toast.classList.remove("show");
      });
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      on(one("#done"), "click", () => {
        if (!inked) {
          hint.style.opacity = ".5";
          setTimeout(() => (hint.style.opacity = ".12"), 500);
          return;
        }
        toast.classList.add("show");
        if (!reduced) confetti(one("#done"));
      });

      if (reduced) return () => off.forEach((f) => f());
      el.classList.add("gsap");
      const snap = "back.out(2.2)", ease = "expo.out";

      const split = SplitText.create(one(".hero h1"), { type: "chars,words", charsClass: "ch" });
      gsap
        .timeline({ defaults: { ease } })
        .from("nav", { yPercent: -100, duration: 0.7 })
        .from(".hero .tag", { y: 20, autoAlpha: 0, duration: 0.5 }, "-=.3")
        .from(split.chars, { yPercent: 120, rotate: () => gsap.utils.random(-25, 25), autoAlpha: 0, duration: 0.9, stagger: 0.025 }, "-=.2")
        .from(".hero .hl", { scale: 0, rotate: -20, duration: 0.7, ease: snap }, "-=.5")
        .add(() => {
          const bar = document.createElement("i");
          Object.assign(bar.style, { position: "absolute", left: "-4px", right: "-4px", top: "52%", height: "10px", background: "var(--red)", transformOrigin: "left" });
          one(".hero .strike").appendChild(bar);
          gsap.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power4.inOut" });
        })
        .from(".hero .lead", { y: 24, autoAlpha: 0, duration: 0.7 }, "-=.3")
        .from(".hero .ctas .btn", { y: 30, autoAlpha: 0, stagger: 0.1, duration: 0.6, ease: snap }, "-=.4")
        .from(".hero .micro span", { x: -10, autoAlpha: 0, stagger: 0.08, duration: 0.4 }, "-=.3")
        .from(".doc.back", { y: -400, rotate: 30, duration: 1, ease: "bounce.out" }, 0.5)
        .from(".doc.front", { y: -500, rotate: -25, duration: 1.1, ease: "bounce.out" }, 0.7)
        .from(".sticker", { scale: 0, rotate: 90, duration: 0.6, ease: snap }, 1.6)
        .from(".stamp", { scale: 3, autoAlpha: 0, rotate: -90, duration: 0.5, ease: "power4.in" }, 1.8)
        .to(".docstack", { x: 6, yoyo: true, repeat: 3, duration: 0.04 }, 2.3)
        .add(() => {
          gsap.to(".doc.front", { y: -8, rotate: -1, duration: 2.5, yoyo: true, repeat: -1, ease: "sine.inOut" });
          gsap.to(".stamp", { rotate: "+=360", duration: 14, repeat: -1, ease: "none" });
          gsap.to(".sticker", { rotate: 3, scale: 1.04, duration: 1.5, yoyo: true, repeat: -1, ease: "sine.inOut" });
        });

      const hero = { trigger: ".hero", start: "top top", end: "bottom top", scrub: true };
      gsap.to(".doc.front", { yPercent: -30, rotate: -8, ease: "none", scrollTrigger: hero });
      gsap.to(".doc.back", { yPercent: -10, rotate: 14, ease: "none", scrollTrigger: hero });
      gsap.to(".hero h1", { xPercent: -6, ease: "none", scrollTrigger: hero });

      const row = one(".marquee .row");
      row.style.animation = "none";
      const mq = gsap.to(row, { xPercent: -50, repeat: -1, duration: 28, ease: "none" });
      ScrollTrigger.create({
        onUpdate: (self) => {
          const v = gsap.utils.clamp(-6, 6, self.getVelocity() / 300);
          gsap.to(mq, { timeScale: v || 1, duration: 0.2, overwrite: true });
          gsap.to(mq, { timeScale: self.direction, duration: 1.2, delay: 0.2 });
          gsap.to(".marquee span", { skewX: -v * 2, duration: 0.3, overwrite: "auto" });
        },
      });

      q(".sech h2, .tryg h2, .final h2").forEach((h) => {
        const s = SplitText.create(h, { type: "lines", mask: "lines" });
        gsap.from(s.lines, { yPercent: 110, duration: 1, stagger: 0.12, ease, scrollTrigger: { trigger: h, start: "top 85%" } });
      });
      q(".sech p, .tryg p, .sech .toggle").forEach((p) => gsap.from(p, { y: 30, autoAlpha: 0, duration: 0.8, ease, scrollTrigger: { trigger: p, start: "top 90%" } }));
      gsap.from(".sgrid", { y: 80, rotate: -2, autoAlpha: 0, duration: 0.9, ease: snap, scrollTrigger: { trigger: ".sgrid", start: "top 85%" } });
      gsap.from(".stat", { rotateX: -90, transformOrigin: "top", autoAlpha: 0, stagger: 0.12, duration: 0.8, ease: snap, scrollTrigger: { trigger: ".sgrid", start: "top 80%" } });
      gsap.from(".step", { y: 160, rotate: (i: number) => [-12, 4, 14][i], autoAlpha: 0, stagger: 0.15, duration: 1, ease: snap, scrollTrigger: { trigger: ".steps", start: "top 80%" } });
      q(".feat").forEach((f, i) =>
        gsap.from(f, { clipPath: i % 2 ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)", duration: 0.9, ease: "power4.inOut", delay: (i % 3) * 0.08, scrollTrigger: { trigger: f, start: "top 88%" } }),
      );
      gsap.from(".pad", { rotateY: 25, rotate: 4, x: 120, autoAlpha: 0, duration: 1.1, ease, scrollTrigger: { trigger: ".pad", start: "top 80%" } });
      q(".rev").forEach((r, i) => gsap.from(r, { x: [-300, 0, 300][i], y: [0, 200, 0][i], autoAlpha: 0, duration: 1, ease: snap, scrollTrigger: { trigger: ".rgrid", start: "top 80%" } }));
      gsap.from(".ratings > div", { scale: 0, stagger: 0.08, duration: 0.5, ease: snap, scrollTrigger: { trigger: ".ratings", start: "top 90%" } });
      gsap.from(".plan", { y: 120, autoAlpha: 0, stagger: { each: 0.12, from: "edges" }, duration: 0.9, ease: snap, scrollTrigger: { trigger: ".pgrid", start: "top 80%" } });
      q(".toggle button").forEach((b) => on(b, "click", () => gsap.fromTo(".pp", { rotateX: 90, y: -10 }, { rotateX: 0, y: 0, duration: 0.5, ease: snap })));
      gsap.from(".faq details", { x: -60, autoAlpha: 0, stagger: 0.08, duration: 0.7, ease, scrollTrigger: { trigger: ".faq", start: "top 80%" } });
      gsap.fromTo(".final h2", { scale: 2.4, rotate: -6 }, { scale: 1, rotate: 0, ease: "none", scrollTrigger: { trigger: ".final", start: "top bottom", end: "center center", scrub: 1 } });
      gsap.from(".final .btn", { scale: 0, rotate: -30, duration: 0.7, ease: snap, scrollTrigger: { trigger: ".final .btn", start: "top 90%" } });
      gsap.to("#prog", { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } });
      // Web fonts change heights after load; recompute trigger positions then.
      document.fonts?.ready.then(() => ScrollTrigger.refresh());

      // Magnetic buttons, square cursor with labels, and 3D tilt.
      q(".btn").forEach((b) => {
        const xTo = gsap.quickTo(b, "x", { duration: 0.4, ease: "power3" }), yTo = gsap.quickTo(b, "y", { duration: 0.4, ease: "power3" });
        on(b, "mousemove", ((e: MouseEvent) => {
          const r = b.getBoundingClientRect();
          xTo((e.clientX - r.left - r.width / 2) * 0.25);
          yTo((e.clientY - r.top - r.height / 2) * 0.35);
        }) as EventListener);
        on(b, "mouseleave", () => (xTo(0), yTo(0)));
      });
      const cur = one("#cur"), lab = one("#curl");
      const [cx, cy] = [gsap.quickTo(cur, "x", { duration: 0.25, ease: "power3" }), gsap.quickTo(cur, "y", { duration: 0.25, ease: "power3" })];
      const [lx, ly] = [gsap.quickTo(lab, "x", { duration: 0.35, ease: "power3" }), gsap.quickTo(lab, "y", { duration: 0.35, ease: "power3" })];
      on(window, "mousemove", ((e: MouseEvent) => {
        cx(e.clientX);
        cy(e.clientY);
        lx(e.clientX);
        ly(e.clientY);
      }) as EventListener);
      const hover = (sel: string, text: string | null) =>
        q(sel).forEach((n) => {
          on(n, "mouseenter", () => {
            cur.classList.add("big");
            if (text) {
              lab.textContent = text;
              gsap.to(lab, { autoAlpha: 1, duration: 0.2 });
            }
            gsap.to(cur, { rotate: 45, duration: 0.3 });
          });
          on(n, "mouseleave", () => {
            cur.classList.remove("big");
            gsap.to(lab, { autoAlpha: 0, duration: 0.2 });
            gsap.to(cur, { rotate: 0, duration: 0.3 });
          });
        });
      hover(".btn, nav a", null);
      hover("#cv", "DRAW");
      hover(".rev", "REAL? NOT YET");
      hover(".stat", "PLACEHOLDER");
      q(".doc.front, .step, .plan").forEach((n) => {
        on(n, "mousemove", ((e: MouseEvent) => {
          const r = n.getBoundingClientRect();
          gsap.to(n, { rotateY: ((e.clientX - r.left) / r.width - 0.5) * 10, rotateX: -((e.clientY - r.top) / r.height - 0.5) * 10, transformPerspective: 800, duration: 0.4, ease: "power2" });
        }) as EventListener);
        on(n, "mouseleave", () => gsap.to(n, { rotateY: 0, rotateX: 0, duration: 0.6, ease: snap }));
      });

      return () => {
        off.forEach((f) => f());
        split.revert();
        el.classList.remove("gsap");
      };
    },
    { scope: root },
  );

  return <div ref={root} className="lp" dangerouslySetInnerHTML={{ __html: html }} />;
}

// Square confetti burst when the try-it signature is adopted.
function confetti(src: HTMLElement) {
  const r = src.getBoundingClientRect(), cols = ["#FFE600", "#FF3D00", "#2F5BFF", "#FF8AD8", "#00D26A", "#000"];
  for (let i = 0; i < 36; i++) {
    const p = document.createElement("i");
    Object.assign(p.style, { position: "fixed", left: `${r.left + r.width / 2}px`, top: `${r.top}px`, width: "10px", height: "10px", background: cols[i % cols.length], border: "2px solid #000", zIndex: "998", pointerEvents: "none" });
    document.body.appendChild(p);
    gsap.to(p, { x: gsap.utils.random(-220, 220), y: gsap.utils.random(-260, -80), rotate: gsap.utils.random(-360, 360), duration: 0.7, ease: "power3.out" });
    gsap.to(p, { y: "+=400", autoAlpha: 0, duration: 1, delay: 0.6, ease: "power2.in", onComplete: () => p.remove() });
  }
}
