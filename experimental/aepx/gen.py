"""
Experimental: write an After Effects .aepx project directly, by cloning blocks from
template.aepx (saved by After Effects 2026, Mac) and patching sizes, ids and names.
Status: the first full test would not open ("No data in aepx file"). The probes in
./probes are waiting to be opened in After Effects to find which change it rejects.
See HANDOFF.md, "After Effects project file (experimental)".
"""
import re,struct,uuid,json,sys,os
T=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'template.aepx'),encoding='utf-8').read()

def find_item(src,iid):
    i=src.find('<iide bdata="%s"/>'%iid);st=src.rfind('<Item>',0,i);depth=0
    for m in re.finditer(r'<(/?)Item>',src[st:]):
        depth+= -1 if m.group(1) else 1
        if depth==0: return st,st+m.end()
def le(n):return struct.pack('<I',n).hex()
def be(n):return struct.pack('>I',n).hex()
def setb(h,off,newhex):
    assert off*2+len(newhex)<=len(h);return h[:off*2]+newhex+h[off*2+len(newhex):]
def esc(t):return t.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
def name32(t):b=t.encode('ascii','replace')[:31];return (b+b'\0'*(32-len(b))).hex()

# Prototype blocks, by item id in template.aepx
rs,re_=find_item(T,'01000000');ROOT=T[rs:re_];PRE=T[:rs]           # root folder "Ratios ..."
ss,se=find_item(T,'0f000000');POST=T[se:];SOL=T[ss:se];GAP=T[re_:ss] # Solids folder
FOLD=T[slice(*find_item(T,'a0000000'))]     # a file folder, "208x720 (13:45)"
MASTER0=T[slice(*find_item(T,'a1000000'))]  # master comp 208x720: text layer + placeholder solid layer
SIZE=T[slice(*find_item(T,'b0000000'))]     # size comp 160x544: nested master + tramline solid layer
SOLID_P=T[slice(*find_item(T,'ad000000'))]  # placeholder solid (master)
SOLID_T=T[slice(*find_item(T,'bc000000'))]  # tramline solid (size comp)

def head_of_folder(block):
    a=block.find('<Sfdr>')+len('<Sfdr>');b=block.rfind('</Sfdr>');return block[:a],block[b:]
state={'item':0x400,'layer':0x2000}
def nid(k):state[k]+=1;return state[k]

def set_item_ids(block,iid,name=None):
    """Item id: little-endian in <iide>, and at byte 19 of <idta>. The name is the first <string> after idta."""
    block=re.sub(r'<iide bdata="[0-9a-f]+"/>','<iide bdata="%s"/>'%le(iid),block,1)
    m=re.search(r'<idta bdata="([0-9a-f]+)"/>',block);h=setb(m.group(1),19,le(iid));block=block[:m.start(1)]+h+block[m.end(1):]
    if name is not None:
        k=block.find('<string',m.end());e=block.find('>',k)
        if block[k:e+1]=='<string/>': block=block[:k]+'<string>%s</string>'%esc(name)+block[e+1:]
        else: e2=block.find('</string>',k);block=block[:k]+'<string>%s</string>'%esc(name)+block[e2+9:]
    return block

def patch_comp(block,iid,name,w,h,parent=None,layer_src=None,layer_names=None):
    """Comp size: two big-endian u16 at <cdta> bytes 140-143. Every layer record (real Layr and the
    hidden DLay/SLay/CLay/SecL view layers) gets a fresh big-endian id in <ldta> bytes 0-3.
    Real layers: source item id at <ldta> bytes 40-43, name at bytes 64-95 and in the next <string>."""
    block=set_item_ids(block,iid,name)
    if parent is not None: block=re.sub(r'<idpi bdata="[0-9a-f]+"/>','<idpi bdata="%s"/>'%le(parent),block,1)
    m=re.search(r'<cdta bdata="([0-9a-f]+)"/>',block);c=setb(m.group(1),140,struct.pack('>HH',w,h).hex());block=block[:m.start(1)]+c+block[m.end(1):]
    out=[];pos=0;real=0;kind=None
    for mm in re.finditer(r'<(Layr|DLay|SLay|CLay|SecL)>|<ldta bdata="([0-9a-f]+)"/>(\s*<string>[^<]*</string>|\s*<string/>)?',block):
        if mm.group(1): kind=mm.group(1);continue
        d=setb(mm.group(2),0,be(nid('layer')));tail=mm.group(3) or ''
        if kind=='Layr':
            if layer_src and real<len(layer_src) and layer_src[real] is not None: d=setb(d,40,be(layer_src[real]))
            if layer_names and real<len(layer_names) and layer_names[real] is not None:
                d=setb(d,64,name32(layer_names[real]));tail=re.sub(r'<string>[^<]*</string>|<string/>','<string>%s</string>'%esc(layer_names[real]),tail,1)
            real+=1
        out.append(block[pos:mm.start()]);out.append('<ldta bdata="%s"/>'%d+tail);pos=mm.end()
    out.append(block[pos:]);return ''.join(out)

def remap_views(block,old,new,scale=None):
    """Hidden view layers store anchor/position as 3 big-endian doubles in <cdat>: comp centre,
    centre +/-5000, and default cameras at centre +/- zoom where zoom = width * 25/18.
    Nested-master Scale is stored as fractions (0.5 = 50%)."""
    (ow,oh),(w,h)=old,new;ocx,ocy,oz=ow/2,oh/2,ow*25/18;cx,cy,z=w/2,h/2,w*25/18
    def ax(v,o,n):
        d=v-o
        for k in (0.0,5000.0,-5000.0):
            if abs(d-k)<1e-3: return n+k
        if abs(d-oz)<1e-3: return n+z
        if abs(d+oz)<1e-3: return n-z
        return None
    out=[];pos=0;kind=None;prop=None
    for mm in re.finditer(r'<(Layr|DLay|SLay|CLay|SecL)>|<tdmn bdata="([0-9a-f]+)"/>|<cdat bdata="([0-9a-f]+)"/>',block):
        if mm.group(1): kind=mm.group(1);continue
        if mm.group(2): prop=bytes.fromhex(mm.group(2)).split(b'\0')[0].decode(errors='replace');continue
        c=bytes.fromhex(mm.group(3));rep=None
        if kind in('DLay','SLay','CLay') and prop in('ADBE Anchor Point','ADBE Position') and len(c)>=24:
            x,y,zz=struct.unpack('>3d',c[:24]);nx=ax(x,ocx,cx);ny=ax(y,ocy,cy)
            nzz=zz if abs(abs(zz)-oz)>1e-3 else (z if zz>0 else -z)
            assert nx is not None and ny is not None,(prop,x,y,zz)
            rep=struct.pack('>3d',nx,ny,nzz).hex()+c[24:].hex()
        if kind=='Layr' and prop=='ADBE Scale' and scale is not None: rep=struct.pack('>3d',scale[0]/100,scale[1]/100,1.0).hex()+c[24:].hex()
        if rep: out.append(block[pos:mm.start(3)]);out.append(rep);pos=mm.end(3)
    out.append(block[pos:]);return ''.join(out)

def set_guides(block,w,h):
    """Six guides live in the master's SecL: GtGd records (first 8 bytes = position double; last byte
    5 = vertical, 6 = horizontal) and one ldat list of 16-byte entries (orientation u32, pad, double)."""
    m=round(min(w,h)*0.05);vals=[m,round(w/2),w-m,m,round(h/2),h-m];k=[0]
    def g(mm):
        b=bytes.fromhex(mm.group(1));v=vals[k[0]];k[0]+=1;return '<GtGd bdata="%s"/>'%(struct.pack('>d',float(v)).hex()+b[8:].hex())
    block=re.sub(r'<GtGd bdata="([0-9a-f]+)"/>',g,block)
    def l(mm):
        b=bytearray(bytes.fromhex(mm.group(1)))
        for i,v in enumerate(vals): b[i*16+8:i*16+16]=struct.pack('>d',float(v))
        return '<ldat bdata="%s"/>'%b.hex()
    sec=block.find('<SecL>');return block[:sec]+re.sub(r'<ldat bdata="([0-9a-f]+)"/>',l,block[sec:],1)

def make_solid(proto,iid,w,h,rgb,name):
    """Solid size: two big-endian u32 at 'Soli'+8 in <sspc>. Colour: ARGB floats at <opti> bytes 10-25;
    name: 256 bytes from <opti> byte 26. Each solid needs a fresh <pgui> GUID."""
    b=set_item_ids(proto,iid)
    m=re.search(r'<sspc bdata="([0-9a-f]+)"/>',b);sp=m.group(1);i=bytes.fromhex(sp).find(b'Soli');sp=setb(sp,i+8,struct.pack('>II',w,h).hex());b=b[:m.start(1)]+sp+b[m.end(1):]
    m=re.search(r'<opti bdata="([0-9a-f]+)"/>',b);op=bytearray(bytes.fromhex(m.group(1)));op[10:26]=struct.pack('>4f',1.0,*rgb)
    nb=name.encode('ascii','replace')[:255];op[26:282]=(nb+b'\0'*256)[:256];b=b[:m.start(1)]+op.hex()+b[m.end(1):]
    return re.sub(r'<pgui bdata="[0-9a-f]+"/>','<pgui bdata="%s"/>'%uuid.uuid4().hex,b)

def build(plan,root_name='Ratios',keep_text=False,update_head=False):
    MASTER=MASTER0
    if not keep_text: a=MASTER.find('<Layr>');b=MASTER.find('<Layr>',a+6);MASTER=MASTER[:a]+MASTER[b:]
    solids=[];folders=[];rhead,rtail=head_of_folder(ROOT)
    for F in plan['files']:
        W,H=F['w'],F['h'];fid=nid('item');mid=nid('item');psid=nid('item')
        solids.append(make_solid(SOLID_P,psid,W,H,(0.851,0.867,0.882),'Placeholder: replace with your artwork'))
        src=[psid] if not keep_text else [None,psid];nm=['Placeholder: replace with your artwork'] if not keep_text else [None,'Placeholder: replace with your artwork']
        mb=patch_comp(MASTER,mid,F['name']+' master',W,H,layer_src=src,layer_names=nm)
        mb=remap_views(mb,(208,720),(W,H));mb=set_guides(mb,W,H);kids=[mb]
        for Z in F['sizes']:
            zid=nid('item');tsid=nid('item');lab='Tramlines' if Z['float'] else 'Background'
            solids.append(make_solid(SOLID_T,tsid,Z['w'],Z['h'],tuple(F['tl']),lab))
            sb=patch_comp(SIZE,zid,Z['name'],Z['w'],Z['h'],parent=mid,layer_src=[mid,tsid],layer_names=[F['name']+' master',lab])
            kids.append(remap_views(sb,(160,544),(Z['w'],Z['h']),scale=(Z['sx'],Z['sy'])))
        fh,ft=head_of_folder(FOLD);fh=set_item_ids(fh,fid,F['name']+' ('+F['ratio']+')');folders.append(fh+''.join(kids)+ft)
    rid=nid('item');rh=set_item_ids(rhead,rid,root_name);sh,st=head_of_folder(SOL)
    out=PRE+rh+''.join(folders)+rtail+GAP+sh+''.join(solids)+st+POST
    if update_head:  # <head> bytes 12-19 look like next item id / next layer id counters (unconfirmed)
        m=re.search(r'<head bdata="([0-9a-f]+)"/>',out);hd=setb(m.group(1),12,be(state['item']+1));hd=setb(hd,16,be(state['layer']+1));out=out[:m.start(1)]+hd+out[m.end(1):]
    return out

def probe_clone():
    """The untouched template plus one copy of the 160x544 comp in the same folder."""
    zid=nid('item');sb=patch_comp(SIZE,zid,'160x544 copy',160,544,parent=0xa1,layer_src=[0xa1,0xbc])
    st,en=find_item(T,'b0000000');return T[:en]+sb+T[en:]

# Usage:
#   python3 gen.py plan.example.json out.aepx              full project, text layer removed
#   python3 gen.py plan.example.json out.aepx --keep-text
#   python3 gen.py --probe-clone out.aepx                 template + one cloned comp
if __name__=='__main__':
    a=sys.argv[1:]
    if a and a[0]=='--probe-clone': s=probe_clone();dst=a[1]
    else:
        plan=json.load(open(a[0]));dst=a[1];s=build(plan,plan.get('root','Ratios'),keep_text='--keep-text' in a)
    open(dst,'w',encoding='utf-8',newline='\n').write(s);print('wrote',dst,len(s),'chars')
