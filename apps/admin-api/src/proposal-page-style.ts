/** Single inline stylesheet for the customer proposal page. CSS only, no external resources. */
export const PROPOSAL_STYLE = `
:root{--ink:#0e1c2f;--ink2:#17304d;--ink3:#27476b;--sand:#f6f0e6;--sand2:#ebe1d0;--paper:#fffdf9;--line:#e3d9c8;--text:#1c2735;--mute:#58627a;--terra:#a8472a;--terra2:#c8643f;--leaf:#2f6b52;--warn:#8a5a00;--r:18px;--serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:4.5rem}
body{margin:0;font:16px/1.6 var(--sans);color:var(--text);background:var(--sand);-webkit-text-size-adjust:100%}
h1,h2,h3{font-family:var(--serif);font-weight:500;line-height:1.15;margin:0;color:var(--ink)}
p{margin:0}a{color:inherit}
.wrap{max-width:68rem;margin:0 auto;padding:0 1rem}
.eyebrow{font-size:.74rem;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:var(--terra)}
.top{position:sticky;top:0;z-index:10;background:var(--ink);color:#f4ecdd;box-shadow:0 2px 14px rgba(8,16,30,.25)}
.top .wrap{justify-content:space-between;display:flex;align-items:center;gap:1rem;min-height:3.4rem}
.brand{max-width:9rem;font-family:var(--serif);font-size:1.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
.top nav{display:flex;gap:.25rem;margin-left:auto;overflow-x:auto;scrollbar-width:none}
.top nav::-webkit-scrollbar{display:none}
.top nav a{text-decoration:none;font-size:.86rem;padding:.5rem .7rem;border-radius:99px;color:#d8cfbd;white-space:nowrap}
.top nav a:hover,.top nav a:focus-visible{background:rgba(255,255,255,.12);color:#fff;outline:none}
.banner{padding:1rem 1.1rem;border-radius:14px;margin:1rem 0 0;font-weight:500;border:1px solid;display:flex;gap:.7rem;align-items:flex-start}
.banner::before{content:"";flex:none;width:.7rem;height:.7rem;border-radius:50%;background:currentColor;margin-top:.45rem}
.banner.ok{background:#e4f1ea;border-color:#a9cdb9;color:#174b36}
.banner.info{background:#fbefd3;border-color:#e2c67e;color:#6b4400}
.banner.bad{background:#fbe6df;border-color:#e3aa98;color:#7d2a12}
.hero{position:relative;margin:1rem 0 0;border-radius:24px;overflow:hidden;color:#fff;min-height:26rem;display:flex;align-items:flex-end;background:linear-gradient(135deg,var(--ink) 0%,var(--ink3) 60%,#5b4a45 100%);box-shadow:0 18px 50px -20px rgba(8,16,30,.55)}
.hero.noimg::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 85% 12%,rgba(200,100,63,.55),transparent 38%),repeating-linear-gradient(135deg,rgba(255,255,255,.045) 0 2px,transparent 2px 22px)}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero.img::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,16,30,.1) 0%,rgba(8,16,30,.35) 45%,rgba(8,16,30,.86) 100%)}
.hero .in{position:relative;z-index:1;padding:5rem 1.4rem 3.4rem;max-width:46rem}
.hero .eyebrow{color:#f1c9a8}
.hero h1{color:#fff;font-size:clamp(2.1rem,7.5vw,4rem);margin:.5rem 0 .8rem;letter-spacing:-.01em}
.hero p.lead{color:#eee6d6;font-size:1.05rem;max-width:36rem}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;margin:-1.5rem .6rem 0;position:relative;z-index:2;box-shadow:0 14px 34px -18px rgba(14,28,47,.4)}
.facts div{background:var(--paper);padding:.9rem 1rem}
.facts dt{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);font-weight:600}
.facts dd{margin:.15rem 0 0;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.facts{margin-bottom:0}
@media(min-width:48rem){.brand{max-width:none}.facts{grid-template-columns:repeat(4,1fr);margin-inline:1.5rem}}
section.sec{padding:3.2rem 0 0}
.sec-head{margin-bottom:1.3rem}
.sec-head h2{font-size:clamp(1.6rem,5vw,2.3rem);margin-top:.35rem}
.card{background:var(--paper);border:1px solid var(--line);border-radius:var(--r);padding:1.3rem;box-shadow:0 10px 30px -22px rgba(14,28,47,.45)}
.price{display:grid;gap:1rem}
@media(min-width:56rem){.price{grid-template-columns:1.15fr 1fr}}
.total{background:linear-gradient(160deg,var(--ink) 0%,var(--ink2) 100%);color:#f4ecdd;border-radius:var(--r);padding:1.6rem 1.4rem;position:relative;overflow:hidden}
.total::after{content:"";position:absolute;right:-3rem;top:-3rem;width:11rem;height:11rem;border-radius:50%;border:2px solid rgba(241,201,168,.28);box-shadow:0 0 0 1.5rem rgba(241,201,168,.07)}
.total .eyebrow{color:#f1c9a8}
.total .big{font-family:var(--serif);font-size:clamp(2.6rem,10vw,4rem);line-height:1.05;margin:.4rem 0 .3rem;color:#fff;position:relative;z-index:1}
.total p{color:#d6cdbb;position:relative;z-index:1}
.kv{display:grid;grid-template-columns:1fr auto;gap:.1rem 1rem;margin:0}
.kv dt{color:var(--mute);padding:.7rem 0;border-bottom:1px solid var(--line)}
.kv dd{margin:0;font-weight:600;text-align:right;padding:.7rem 0;border-bottom:1px solid var(--line);color:var(--ink)}
.kv dt:last-of-type,.kv dd:last-of-type{border-bottom:0}
.kv .sub{display:block;font-weight:400;font-size:.82rem;color:var(--mute)}
.cards2{display:grid;gap:1rem}
@media(min-width:48rem){.cards2{grid-template-columns:1fr 1fr}}
.flight .dir{display:flex;justify-content:space-between;align-items:center;gap:.5rem;font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:var(--terra)}
.flight .dir span+span{color:var(--mute);letter-spacing:.04em;text-transform:none;font-weight:500;font-size:.85rem}
.route{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:.8rem;margin:1.1rem 0 .9rem}
.route .t{font-family:var(--serif);font-size:2.4rem;line-height:1;color:var(--ink)}
.route .c{font-weight:700;letter-spacing:.12em;color:var(--ink3);margin-top:.25rem}
.route .r{text-align:right}
.line{height:2px;background:repeating-linear-gradient(90deg,var(--terra2) 0 6px,transparent 6px 12px);position:relative;min-width:2rem}
.line::after{content:"";position:absolute;right:-1px;top:-5px;border:6px solid transparent;border-left:10px solid var(--terra2);border-right:0}
.flight .info{display:flex;flex-wrap:wrap;gap:.4rem 1.4rem;border-top:1px solid var(--line);padding-top:.8rem;font-size:.9rem;color:var(--mute)}
.flight .info b{color:var(--ink);font-weight:600}
.stay{display:grid;overflow:hidden;padding:0}
@media(min-width:48rem){.stay.has{grid-template-columns:5fr 6fr}}
.stay .ph{min-height:14rem;background:linear-gradient(135deg,var(--ink3),var(--ink));position:relative}
.stay .ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.stay .body{padding:1.4rem}
.stay h3{font-size:1.6rem;margin:.3rem 0 .4rem}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:.9rem 1rem;margin:1.1rem 0 0}
.grid dt{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);font-weight:600}
.grid dd{margin:.1rem 0 0;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.desc{color:var(--mute);overflow-wrap:anywhere;white-space:pre-line}
.stays{display:grid;gap:1rem}
.timeline{list-style:none;margin:0;padding:0 0 0 0;position:relative}
.timeline::before{content:"";position:absolute;left:1.35rem;top:1rem;bottom:1rem;width:2px;background:var(--sand2)}
.timeline li{position:relative;display:grid;grid-template-columns:2.8rem 1fr;gap:1rem;margin-bottom:.9rem}
.timeline .n{width:2.8rem;height:2.8rem;border-radius:50%;background:var(--ink);color:#f4ecdd;font-family:var(--serif);font-size:1.1rem;display:grid;place-items:center;position:relative;z-index:1;box-shadow:0 0 0 5px var(--sand)}
.timeline .card{padding:1rem 1.2rem}
.timeline h3{font-size:1.25rem;margin-top:.2rem}
.timeline .desc{margin-top:.4rem}
.svc{display:grid;gap:1rem}
@media(min-width:48rem){.svc{grid-template-columns:1fr 1fr}}
.svc .card{padding:0;overflow:hidden;display:flex;flex-direction:column}
.svc img{width:100%;height:10rem;object-fit:cover;display:block}
.svc .b{padding:1.1rem 1.2rem}
.svc h3{font-size:1.2rem;margin:.25rem 0 .3rem}
.opt{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}
.opt .p{font-family:var(--serif);font-size:1.4rem;color:var(--terra);white-space:nowrap}
.opts{display:grid;gap:1rem}
@media(min-width:48rem){.opts{grid-template-columns:1fr 1fr}}
.opt h3{font-size:1.15rem}
.inex{display:grid;gap:1rem}
@media(min-width:48rem){.inex{grid-template-columns:1fr 1fr}}
.inex h3{font-size:1.3rem;margin-bottom:.8rem}
.inex h4{margin:1rem 0 .3rem;font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
.inex ul{list-style:none;margin:0;padding:0}
.inex li{position:relative;padding:.3rem 0 .3rem 1.8rem;overflow-wrap:anywhere}
.inex li::before{position:absolute;left:0;top:.35rem;width:1.3rem;height:1.3rem;border-radius:50%;display:grid;place-items:center;font-size:.78rem;font-weight:700;line-height:1}
.inex .yes li::before{content:"\\2713";background:#dcefe4;color:#1d5a40}
.inex .no li::before{content:"\\2715";background:#f6dfd7;color:#8a3519}
.cond{padding:1.3rem}
.cond ul{margin:0;padding-left:1.2rem;color:var(--text)}
.cond li{margin:.4rem 0}
.accept{background:linear-gradient(160deg,var(--ink) 0%,var(--ink2) 100%);color:#f4ecdd;border-radius:24px;padding:1.8rem 1.4rem;display:grid;gap:1.4rem}
@media(min-width:56rem){.accept{grid-template-columns:1fr 1fr;padding:2.4rem;align-items:center}}
.accept h2{color:#fff;font-size:clamp(1.7rem,5vw,2.4rem)}
.accept .eyebrow{color:#f1c9a8}
.accept p{color:#d6cdbb;margin-top:.6rem}
.accept form{background:var(--paper);color:var(--text);border-radius:var(--r);padding:1.3rem;display:grid;gap:1rem}
.accept label.f{font-weight:600;color:var(--ink);display:grid;gap:.35rem}
.accept input[type=text]{font:inherit;padding:.8rem .9rem;border:1.5px solid #b9ad97;border-radius:12px;background:#fff;color:var(--text);width:100%}
.accept input[type=text]:focus-visible,.accept input[type=checkbox]:focus-visible,.accept button:focus-visible{outline:3px solid var(--terra2);outline-offset:2px}
.accept label.ck{display:flex;gap:.7rem;align-items:flex-start;font-size:.95rem}
.accept input[type=checkbox]{width:1.3rem;height:1.3rem;flex:none;margin-top:.15rem;accent-color:var(--terra)}
.accept button{font:inherit;font-weight:700;border:0;border-radius:14px;padding:.95rem 1.2rem;background:var(--terra);color:#fff;cursor:pointer;min-height:3rem}
.accept button:hover{background:#913a20}
.hint{font-size:.85rem;color:var(--mute);margin-top:1.4rem;text-align:center}
.foot{margin-top:3rem;background:var(--ink);color:#b9b19f;padding:1.6rem 0;font-size:.88rem}
.foot .wrap{display:flex;flex-wrap:wrap;gap:.4rem 1.5rem;justify-content:space-between}
.foot strong{color:#f4ecdd;font-family:var(--serif);font-weight:500;font-size:1.05rem}
.err{font-weight:600}
.page-pad{padding-bottom:0}
@media print{
body{background:#fff;font-size:11pt}.top,.accept form,.accept.act,.banner.bad,.hint,.noprint{display:none!important}
.hero{min-height:12rem;box-shadow:none;break-inside:avoid;color:#000;background:#fff;border:1px solid #999}
.hero.img::after,.hero.noimg::before{display:none}.hero h1,.hero p.lead{color:#000}.hero .eyebrow{color:#555}
.hero img{display:none}.facts{margin:1rem 0 0}.card,.total,.timeline li{break-inside:avoid;box-shadow:none}
.total{background:#fff;color:#000;border:1px solid #999}.total .big,.total p{color:#000}.total::after{display:none}
.foot{background:#fff;color:#444;border-top:1px solid #999}.foot strong{color:#000}
section.sec{padding-top:1.4rem}
}
`;
