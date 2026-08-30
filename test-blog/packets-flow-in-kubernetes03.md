# kube-proxy Deep Dive: How Kubernetes Turns a Virtual IP into a Real Pod (Part 1)

## Understanding the Invisible Load Balancer Behind Every Kubernetes Service

> *"If CoreDNS returns a Service IP that doesn't belong to any Pod, who receives the packet?"*

In the previous article, we uncovered one of Kubernetes' biggest mysteries.

Our frontend Pod wanted to communicate with the backend Service.

```bash id="bn4ov2"
curl http://backend.backend
```

CoreDNS resolved the request and returned:

```text id="by3g3u"
10.96.18.72
```

Our application happily opened a TCP connection to that address.

Everything worked perfectly.

But there's one small problem.

That IP doesn't actually exist.

---

# Let's Prove It

Run:

```bash id="nd2mhr"
kubectl get svc -n backend
```

Example:

```text id="xrzqna"
NAME       TYPE        CLUSTER-IP

backend    ClusterIP   10.96.18.72
```

Now let's look at every Pod.

```bash id="lfc2sk"
kubectl get pods -A -o wide
```

Example:

```text id="0v8jtb"
NAMESPACE   NAME             IP

backend     backend-1        10.244.1.8

backend     backend-2        10.244.2.14

backend     backend-3        10.244.3.6
```

Do you see the problem?

None of the Pods own:

```text id="p7hjol"
10.96.18.72
```

Maybe one of the nodes owns it?

Let's check.

```bash id="6v31fr"
ip addr
```

Again...

Nothing.

No network interface has that address.

Not the Pods.

Not the nodes.

Not the control plane.

Yet packets sent to that IP somehow reach the backend Pods.

This is one of Kubernetes' cleverest networking tricks.

---

# The ClusterIP Isn't a Real IP

When people first learn Kubernetes, they usually imagine something like this.

```text id="xqjlwm"
Frontend Pod

        │

        ▼

10.96.18.72

        │

        ▼

Backend Pod
```

As if there were a server somewhere listening on:

```text id="td0lk9"
10.96.18.72
```

There isn't.

A ClusterIP is **virtual**.

It's simply an address that Kubernetes promises applications they can always use.

Think of it as a destination label rather than a physical machine.

The packet is never supposed to arrive there.

Instead, Kubernetes intercepts the packet before it ever reaches its "destination."

Someone quietly changes the destination address while the packet is traveling.

From your application's perspective:

```text id="0vtb1t"
Destination

10.96.18.72
```

From Linux's perspective a fraction of a millisecond later:

```text id="gb9vnm"
Destination

10.244.2.14
```

Your application never notices.

---

# Meet kube-proxy

The component responsible for this magic is **kube-proxy**.

Despite its name, kube-proxy is **not** a traditional network proxy.

It doesn't sit between clients and servers copying packets back and forth.

Instead, kube-proxy programs the Linux networking stack so that packets are automatically redirected.

That's a huge difference.

Imagine a hotel receptionist.

A guest walks in asking for Room 100.

The receptionist knows Room 100 is currently unavailable.

Instead of telling the guest,

she quietly hands them the key to Room 214.

From the guest's perspective,

they simply asked for Room 100 and somehow ended up in the correct room.

That's essentially what kube-proxy does.

Applications send traffic to a Service.

kube-proxy quietly redirects that traffic to one of the Pods behind the Service.

---

# Where Does kube-proxy Run?

Every worker node runs its own kube-proxy.

Let's verify that.

```bash id="pggqf5"
kubectl get daemonset -n kube-system
```

You'll likely see something similar to:

```text id="m0avzb"
NAME

kube-proxy
```

Now inspect the Pods.

```bash id="9zlwpj"
kubectl get pods -n kube-system -l k8s-app=kube-proxy
```

Example:

```text id="v2yztv"
kube-proxy-6fw8d

kube-proxy-hl3pn

kube-proxy-mbtsq
```

One Pod per node.

This is why kube-proxy is deployed as a **DaemonSet**.

Every node needs to understand how Services should behave because every node might receive traffic destined for a Service.

---

# The Big Picture

Your cluster now contains something like this.

```text id="9l2bza"
                    Kubernetes Cluster

──────────────────────────────────────────────────────

Worker Node 1

Frontend Pod

kube-proxy

──────────────────────────────────────────────────────

Worker Node 2

Backend Pod

Backend Pod

kube-proxy

──────────────────────────────────────────────────────

Worker Node 3

Backend Pod

kube-proxy

──────────────────────────────────────────────────────
```

Notice something.

There isn't one giant kube-proxy.

Every node has its own.

Each one knows about every Service in the cluster.

That way,

no matter where a packet arrives,

the node already knows how to redirect it.

---

# But How Does kube-proxy Know About Every Service?

This should sound familiar.

It's exactly the same strategy we saw with CoreDNS.

kube-proxy doesn't repeatedly ask the API Server questions.

Instead,

it watches the cluster.

When kube-proxy starts,

it performs two important steps.

First,

it downloads the current state of the cluster.

```text id="5bhm6o"
API Server

↓

List Services

↓

List EndpointSlices
```

Then,

it opens watch connections.

```text id="ly2g8x"
Watch Services

Watch EndpointSlices
```

From that point onward,

every change is delivered as an event.

Create a Service?

kube-proxy is notified.

Delete a Pod?

kube-proxy is notified.

Scale a Deployment?

The EndpointSlice changes.

kube-proxy is notified again.

No polling.

No repeatedly querying the API Server.

Exactly the same informer pattern we learned about in the CoreDNS article.

---

# Services Alone Aren't Enough

Suppose our backend Service looks like this.

```yaml id="6gz6xk"
apiVersion: v1
kind: Service
metadata:
  name: backend
spec:
  selector:
    app: backend
```

That's useful.

But it still doesn't tell kube-proxy where the Pods are.

Remember,

Services don't contain Pod IPs.

EndpointSlices do.

Let's inspect one.

```bash id="xv67wr"
kubectl get endpointslices \
-n backend
```

Describe it.

```bash id="i4oz0s"
kubectl describe endpointslice \
backend-xxxxx \
-n backend
```

Example:

```text id="rjqcc5"
Addresses

10.244.1.8

10.244.2.14

10.244.3.6
```

Now kube-proxy has everything it needs.

It knows:

> "Packets sent to **10.96.18.72** should be redirected to one of these three Pod IPs."

The only remaining question is:

**How does it actually redirect the packet?**

Does kube-proxy copy packets?

Does it open sockets?

Does it run a load balancer?

Does it use Linux networking features?

The answer is far more elegant than most people expect.

Rather than handling packets itself, kube-proxy teaches the **Linux kernel** how to rewrite packets automatically.

It does this using technologies such as **iptables**, **IPVS**, or **nftables**, depending on the mode it's running in.

Those technologies are the real engines behind Kubernetes Services, and understanding them will completely change how you think about networking inside a cluster.

In the next part, we'll step inside the Linux kernel, inspect the rules kube-proxy installs, and watch a packet's destination IP transform from a virtual Service address into the IP address of a real backend Pod—all before your application even realizes it happened.

# kube-proxy Deep Dive: How Kubernetes Turns a Virtual IP into a Real Pod (Part 2)

## How the Linux Kernel Rewrites Packets Before They Reach Your Application

At the end of Part 1, we discovered something surprising.

kube-proxy doesn't actually proxy packets.

It never sits in the middle of the connection.

It never accepts TCP connections from clients.

It never forwards packets itself.

Instead, kube-proxy teaches the **Linux kernel** how packets should be handled.

That distinction is incredibly important.

Once kube-proxy has finished its work, it can go to sleep.

The Linux kernel does all the heavy lifting.

---

# Let's Follow the Packet Again

Our frontend Pod sends this request:

```bash id="0w7v8u"
curl http://backend.backend
```

CoreDNS responds:

```text id="c92h0s"
10.96.18.72
```

The application now creates a TCP packet.

```text id="thf9l5"
Source IP

10.244.1.5

Destination IP

10.96.18.72
```

The packet leaves the frontend Pod.

Now something interesting happens.

Before the packet reaches any network interface...

Before it reaches another node...

Before it reaches the backend Pod...

The Linux kernel examines it.

```text id="5jdbk5"
Frontend Pod

        │

TCP Packet

Destination:

10.96.18.72

        │

        ▼

Linux Kernel

        │

        ▼

???
```

This is where kube-proxy's work begins.

---

# kube-proxy Doesn't Handle Packets

Many engineers imagine something like this.

```text id="ktgqxu"
Frontend

     │

     ▼

kube-proxy

     │

     ▼

Backend
```

That isn't what happens.

The packet never enters kube-proxy.

Instead,

kube-proxy installs rules inside Linux.

Think of it like programming a GPS.

You don't sit inside the GPS telling it where every car should drive.

You configure the routes once.

Then every car automatically follows them.

That's exactly what kube-proxy does.

It programs the networking rules.

The kernel follows those rules.

---

# Meet iptables

Historically,

the most common backend used by kube-proxy has been **iptables**.

iptables is part of the Linux kernel's packet filtering and Network Address Translation (NAT) framework.

It allows Linux to inspect packets and decide things like:

* Should this packet be accepted?
* Should it be dropped?
* Should it be redirected?
* Should its source address change?
* Should its destination address change?

Kubernetes uses one particular capability extensively:

**Destination NAT (DNAT).**

---

# What Is DNAT?

Suppose our packet looks like this.

```text id="s8xq1x"
Source

10.244.1.5

Destination

10.96.18.72
```

The destination is the Service IP.

iptables recognizes that IP as belonging to a Kubernetes Service.

It immediately rewrites the destination.

```text id="jxrg1r"
Before

Destination

10.96.18.72

──────────────

After

Destination

10.244.2.14
```

Notice something.

The application never changed.

The TCP connection never changed.

Only the packet header changed.

From this point onward,

the packet travels toward the actual backend Pod.

---

# Who Installed Those Rules?

Not you.

Not the kernel.

kube-proxy.

Every time Services or EndpointSlices change,

kube-proxy regenerates the required networking rules.

You can actually inspect them.

```bash id="y3b5zv"
sudo iptables-save
```

You'll see hundreds of rules with names like:

```text id="40kjhh"
KUBE-SERVICES

KUBE-SVC-XXXXX

KUBE-SEP-XXXXX
```

At first,

they look terrifying.

They're actually very systematic.

Let's understand what each one does.

---

# `KUBE-SERVICES`

Think of this as the entry point.

Whenever a packet is destined for a Kubernetes Service,

Linux checks this chain.

Conceptually,

it looks something like this.

```text id="np1uh0"
Packet

Destination

10.96.18.72

        │

        ▼

KUBE-SERVICES

        │

Matches

backend Service

        │

        ▼

Jump to

KUBE-SVC-A8F73...
```

The first chain simply answers:

> "Which Service does this packet belong to?"

---

# `KUBE-SVC-*`

Each Service gets its own chain.

Imagine our backend Service.

```text id="4h3jlwm"
backend

↓

KUBE-SVC-A8F73
```

This chain performs load balancing.

Suppose we have three Pods.

```text id="jslq87"
Pod A

10.244.1.8

────────────

Pod B

10.244.2.14

────────────

Pod C

10.244.3.6
```

The Service chain decides which backend should receive this request.

Then it jumps again.

```text id="1phtn4"
KUBE-SVC

        │

Choose Pod B

        │

        ▼

KUBE-SEP-DF82...
```

---

# `KUBE-SEP-*`

SEP stands for **Service Endpoint**.

Each backend Pod gets one of these chains.

Its job is straightforward.

Rewrite the destination IP.

```text id="e5txr6"
Destination

10.96.18.72

↓

Destination

10.244.2.14
```

That's it.

The packet is now heading toward a real Pod.

---

# Seeing the Flow

Let's combine everything.

```text id="hr9a2s"
Frontend Pod

Destination

10.96.18.72

        │

        ▼

Linux Kernel

        │

        ▼

KUBE-SERVICES

        │

        ▼

KUBE-SVC

        │

Chooses Pod

        │

        ▼

KUBE-SEP

        │

DNAT

        ▼

Destination

10.244.2.14

        │

        ▼

Backend Pod
```

Notice again:

kube-proxy isn't in this diagram.

Because it isn't processing packets.

It already finished its work.

---

# Does Every Packet Go Through These Rules?

Only the first packet of a new connection.

This is another optimization.

Linux uses a subsystem called **conntrack** (connection tracking).

When the first packet arrives,

iptables decides which backend Pod should receive it.

Linux then remembers that decision.

Every subsequent packet in the same TCP connection follows the exact same path.

Imagine downloading a large file.

Thousands of packets belong to one TCP connection.

It would be disastrous if packet one went to Pod A,

packet two to Pod B,

and packet three to Pod C.

Your application would immediately break.

Instead,

conntrack ensures:

```text id="a6djlwm"
Connection

↓

Pod B

↓

Remember Decision

↓

All Future Packets

↓

Pod B
```

We'll explore conntrack in much more detail in the networking article later in this series because it's also responsible for many aspects of Kubernetes NAT and packet return paths.

---

# What Happens When a Pod Dies?

Suppose Pod B crashes.

```text id="w3pjlwm"
Pod A

Running

──────────

Pod B

Deleted

──────────

Pod C

Running
```

The EndpointSlice changes.

The API Server sends an event.

kube-proxy receives it.

iptables rules are regenerated.

Future connections are now sent only to Pods A and C.

Existing connections may fail—that depends on the application protocol—but new connections immediately avoid the deleted Pod.

This entire update process usually happens within seconds.

No administrator needs to edit firewall rules manually.

---

# Why iptables Isn't the Only Option

iptables served Kubernetes well for many years.

It's mature.

Reliable.

Widely available.

But as clusters grew,

a weakness became obvious.

Imagine a cluster with:

* 10,000 Services
* 80,000 Pods

iptables must evaluate many rules before finding the correct Service.

As the rule set grows,

lookup time increases.

It's still fast,

but not ideal for extremely large clusters.

To solve that,

Kubernetes introduced another backend:

**IPVS**.

Later,

Linux evolved again,

bringing **nftables**, which is gradually becoming the preferred packet filtering framework in modern distributions.

Each backend achieves the same goal—redirecting packets from a Service IP to a backend Pod—but they use different data structures and kernel capabilities to do it.

In the next part, we'll compare **iptables**, **IPVS**, and **nftables**, understand why Kubernetes supports all three, and learn when each one is the right choice for your cluster.

# kube-proxy Deep Dive: How Kubernetes Turns a Virtual IP into a Real Pod (Part 3)

## iptables vs. IPVS vs. nftables — Three Different Ways to Build a Kubernetes Service

By now, we know that kube-proxy doesn't proxy traffic.

Instead, it programs the Linux kernel.

The only remaining question is:

> **How should the Linux kernel perform that forwarding?**

Over the years, Kubernetes has supported three different approaches:

* **iptables**
* **IPVS**
* **nftables**

All three solve the same problem:

> "Packets sent to a Service IP should reach one of the backend Pods."

The difference is **how** they solve it.

---

# Option 1 — iptables

This is the oldest and most widely used mode.

Conceptually, iptables works like a long list of instructions.

Imagine airport security.

Every passenger arrives.

The officer asks a series of questions.

```text id="vmp6r8"
Is this passenger flying internationally?

↓

No

↓

Next Question

↓

Business Class?

↓

No

↓

Next Question

↓

Priority Boarding?

↓

Yes

↓

Go Here
```

Packets go through a similar process.

```text id="krn92x"
Packet Arrives

        │

Rule 1

        │

Rule 2

        │

Rule 3

        │

Rule 4

        │

Match Found

        │

DNAT
```

The kernel evaluates rules until it finds one that matches.

For a small cluster,

this works extremely well.

---

# What Happens as the Cluster Grows?

Imagine your cluster contains:

* 25 Services

iptables remains very small.

Finding the correct rule is almost instantaneous.

Now imagine:

* 5,000 Services

Every Service creates multiple rules.

Every Endpoint creates additional rules.

Suddenly,

the rule set becomes enormous.

Although Linux is highly optimized,

finding the correct rule generally requires walking through more of that rule set.

That's why kube-proxy periodically rewrites the rules whenever Services or EndpointSlices change.

For most clusters,

iptables is perfectly adequate.

For very large clusters,

another solution performs better.

---

# Option 2 — IPVS

IPVS stands for **IP Virtual Server**.

Unlike iptables,

IPVS wasn't originally designed as a firewall.

It was designed as a **high-performance Layer 4 load balancer**.

Instead of managing thousands of packet-filtering rules,

IPVS maintains an internal table of virtual servers.

Imagine the difference between:

Searching through a paper phone book...

versus

Searching a database.

Conceptually,

iptables looks like this.

```text id="z7gskm"
Rule

↓

Rule

↓

Rule

↓

Rule

↓

Rule

↓

Match
```

IPVS looks more like this.

```text id="8u7xiu"
Virtual Service

↓

Lookup Table

↓

Backend Pod
```

Instead of evaluating long chains,

Linux performs a much faster lookup.

---

# Inspecting IPVS

If your cluster uses IPVS,

you can inspect it.

```bash id="iqbgh5"
sudo ipvsadm -Ln
```

Example output:

```text id="jlwmf3"
TCP 10.96.18.72:80

-> 10.244.1.8:80

-> 10.244.2.14:80

-> 10.244.3.6:80
```

Notice how readable this is.

One virtual Service.

Several backend Pods.

That's exactly the mental model we've been building throughout this series.

---

# IPVS Scheduling Algorithms

One advantage IPVS has over iptables is that it supports multiple load-balancing algorithms.

For example:

### Round Robin

```text id="gwdg4u"
Pod A

↓

Pod B

↓

Pod C

↓

Pod A
```

Very simple.

Every Pod receives roughly the same number of connections.

---

### Least Connections

Instead of rotating,

IPVS can choose the backend currently handling the fewest active connections.

Imagine:

```text id="cxtah4"
Pod A

120 connections

──────────────

Pod B

34 connections

──────────────

Pod C

41 connections
```

A new client will likely be sent to Pod B.

---

### Source Hashing

Sometimes,

you want the same client to consistently reach the same backend.

For example,

web applications maintaining local session state.

IPVS can hash the client's source address and repeatedly choose the same backend.

These scheduling options made IPVS particularly attractive for large production environments.

---

# Why Didn't Everyone Switch to IPVS?

For several years,

many Kubernetes guides recommended:

> "Use IPVS whenever possible."

That was reasonable advice at the time.

However,

Linux networking continued to evolve.

A newer framework began replacing iptables itself.

That framework is:

**nftables**.

---

# Option 3 — nftables

If you've used Linux recently,

you've probably encountered nftables.

It's the modern successor to iptables.

Instead of maintaining multiple independent tools:

* iptables
* ip6tables
* arptables
* ebtables

Linux now provides a unified packet filtering framework.

Conceptually,

nothing changes from Kubernetes' perspective.

Packets still arrive.

Rules still match.

DNAT still occurs.

The difference lies in the underlying implementation.

nftables is:

* simpler
* more efficient
* easier to maintain
* better integrated with modern Linux kernels

Many Linux distributions already implement the old iptables commands using nftables underneath.

So even when you type:

```bash id="af1o4k"
iptables-save
```

you may actually be interacting with nftables behind the scenes.

---

# Comparing the Three Modes

Let's summarize.

| Feature                   | iptables                     | IPVS                           | nftables                                           |
| ------------------------- | ---------------------------- | ------------------------------ | -------------------------------------------------- |
| Primary Purpose           | Firewall + NAT               | Layer 4 Load Balancer          | Modern packet filtering framework                  |
| Rule Processing           | Sequential rule evaluation   | Lookup tables                  | Efficient rule evaluation using nftables framework |
| Load Balancing Algorithms | Basic                        | Multiple scheduling algorithms | Depends on implementation                          |
| Scalability               | Good                         | Excellent                      | Excellent                                          |
| Operational Complexity    | Low                          | Medium                         | Low                                                |
| Modern Direction          | Legacy but still widely used | Supported                      | Increasingly preferred on modern Linux systems     |

The important thing to remember is this:

Regardless of the backend,

your application behaves exactly the same.

It still sends packets to:

```text id="gqbjlwm"
10.96.18.72
```

The backend implementation is completely transparent.

---

# Session Affinity

Sometimes,

load balancing isn't enough.

Imagine a shopping website.

A customer logs in.

Their session is stored locally inside one backend Pod.

If every request randomly reaches a different Pod,

the user might appear to log out between requests.

Kubernetes provides **Session Affinity** to solve this.

```yaml id="tgdfn9"
sessionAffinity: ClientIP
```

Now,

clients coming from the same IP address are consistently routed to the same backend Pod for a configurable period.

Internally,

kube-proxy adjusts how it selects endpoints,

while conntrack helps ensure existing TCP connections remain stable.

---

# Internal vs. External Traffic Policies

Two other Service settings often appear in production clusters.

```yaml id="up0oeh"
internalTrafficPolicy
```

and

```yaml id="pjlwm8"
externalTrafficPolicy
```

These determine **which endpoints are eligible** to receive traffic.

For example,

`internalTrafficPolicy: Local`

tells Kubernetes:

> "Only send traffic to Pods running on the same node."

If no local Pod exists,

the request fails rather than crossing the network to another node.

This can reduce latency for node-local workloads.

Similarly,

`externalTrafficPolicy: Local`

is commonly used with LoadBalancer and NodePort Services when preserving the client's original source IP is important.

We'll revisit both settings when we discuss external traffic in the next networking article.

---

# Following the Packet Again

Let's replay our packet one more time.

```text id="e3bnm6"
Application

        │

Destination

10.96.18.72

        │

        ▼

Linux Kernel

        │

iptables

or

IPVS

or

nftables

        │

DNAT

        ▼

Destination

10.244.2.14

        │

        ▼

Backend Pod
```

No matter which backend Kubernetes uses,

the overall journey never changes.

The only thing that changes is **how the Linux kernel decides where to send the packet**.

---

# But What Happens When the Backend Pod Lives on Another Node?

So far,

we've quietly assumed that rewriting the destination IP is enough.

But imagine this situation.

```text id="pjlwm9"
Worker Node 1

Frontend Pod

10.244.1.5

────────────────────────

Worker Node 2

Backend Pod

10.244.2.14
```

The packet now knows the backend Pod's IP.

Great.

But how does it actually cross the network?

How does one node know where another node's Pods live?

Does Kubernetes add static routes?

Does the CNI build an overlay network?

Does it encapsulate packets using VXLAN or Geneve?

Or does it use BGP to advertise Pod networks?

At this point, kube-proxy's job is finished.

It has transformed a **virtual Service IP** into a **real Pod IP**.

From here onward, responsibility shifts to another critical component of Kubernetes:

**the Container Network Interface (CNI).**

In the final part of this article, we'll complete kube-proxy's story by discussing NodePort, LoadBalancer Services, Hairpin Mode, and the practical debugging techniques you should use whenever Service routing doesn't behave as expected. Then, in the next article of the series, we'll follow the packet beyond kube-proxy and into the networking fabric that connects every node in the cluster.

# kube-proxy Deep Dive: How Kubernetes Turns a Virtual IP into a Real Pod (Part 4)

## NodePorts, LoadBalancers, Hairpin Mode, and Debugging Kubernetes Services

Throughout this article, we've focused on one type of Service:

```yaml id="n2y9am"
type: ClusterIP
```

That's the default Service type in Kubernetes.

It allows Pods inside the cluster to communicate with one another.

But Kubernetes supports several Service types, and they all build upon the same foundation we've already learned.

Understanding how they relate makes the rest of Kubernetes networking much easier to grasp.

---

# ClusterIP: The Foundation

Every Service starts life as a ClusterIP Service.

```text id="72ozq6"
Frontend Pod

        │

10.96.18.72

        │

        ▼

kube-proxy

        │

DNAT

        ▼

Backend Pod
```

Everything we've discussed so far applies here:

* CoreDNS resolves the Service name.
* kube-proxy intercepts packets destined for the Service IP.
* The Linux kernel rewrites the destination address.
* The CNI delivers the packet to the chosen Pod.

Once you understand ClusterIP, the other Service types are simply different ways of getting traffic **into** the cluster.

---

# NodePort

Suppose your application needs to be reachable from outside the cluster.

One option is a NodePort Service.

```yaml id="y3e70g"
apiVersion: v1
kind: Service
metadata:
  name: backend
spec:
  type: NodePort
```

Kubernetes allocates a high-numbered port on **every node**.

For example:

```text id="h6b5ob"
30080
```

Now every node accepts traffic on that port.

```text id="fhjlwm"
               Kubernetes Cluster

        Node 1              Node 2

192.168.1.10         192.168.1.11

      │                    │

      │:30080              │:30080

      ▼                    ▼

         kube-proxy

              │

              ▼

         Backend Pods
```

Notice something interesting.

Even if the backend Pod is running only on Node 2,

connecting to:

```text id="nccmr8"
192.168.1.10:30080
```

still works.

Why?

Because kube-proxy redirects the request across the cluster to whichever backend Pod it selects.

From the client's perspective, every node appears capable of serving the application.

---

# LoadBalancer

If your cluster runs in a cloud environment, you'll often use:

```yaml id="zm2tva"
type: LoadBalancer
```

This builds on top of NodePort.

Conceptually:

```text id="ls7fq5"
Internet

      │

      ▼

Cloud Load Balancer

      │

      ▼

NodePort

      │

      ▼

kube-proxy

      │

      ▼

Backend Pods
```

The cloud provider provisions an external load balancer.

That load balancer forwards traffic to the NodePort on one or more worker nodes.

From there, kube-proxy performs the same Service routing we've been discussing throughout this article.

The important takeaway is this:

A LoadBalancer Service doesn't replace kube-proxy.

It relies on it.

---

# ExternalTrafficPolicy

Earlier, we briefly mentioned:

```yaml id="j2jlwm"
externalTrafficPolicy: Local
```

Now let's see why it exists.

Imagine this cluster.

```text id="nrjlwm"
Client

      │

      ▼

Node 1

(No Backend Pod)

      │

      ▼

Node 2

Backend Pod
```

By default:

```yaml id="gjlwm4"
externalTrafficPolicy: Cluster
```

Node 1 accepts the connection.

Then forwards it to Node 2.

Simple.

But there's a catch.

During this forwarding process, the client's original source IP may be replaced.

Your application might see:

```text id="jlwm56"
10.244.x.x
```

instead of the client's real public IP.

For many applications, that's fine.

For others—logging, rate limiting, geolocation, audit trails—it isn't.

Setting:

```yaml id="q8jlwm"
externalTrafficPolicy: Local
```

changes the behavior.

A node only accepts external traffic if it already has a local backend Pod.

No cross-node forwarding occurs.

The trade-off is availability.

If a node doesn't host a backend Pod, it won't serve requests.

---

# Hairpin Mode

Here's a fun scenario.

Suppose a backend Pod connects to its own Service.

```text id="jlwmy7"
Backend Pod

        │

backend Service

        │

        ▼

kube-proxy

        │

        ▼

Backend Pod
```

At first glance, this seems harmless.

But without special handling, the packet could leave the Pod and fail to return correctly because Linux doesn't normally expect traffic to loop back through a virtual Service.

This situation is called **hairpin traffic**.

The name comes from the shape of the packet's path.

```text id="vjlwm2"
Pod

 │

 ▼

Service

 │

 ▼

Same Pod
```

Like a hairpin bending back toward itself.

Modern Kubernetes distributions and CNIs usually enable hairpin handling automatically, but it's useful to know the term because you'll encounter it when debugging networking issues.

---

# How to See What kube-proxy Is Doing

One of the best ways to understand kube-proxy is to inspect what it has programmed into the node.

If you're using iptables:

```bash id="jlwmi9"
sudo iptables-save
```

Look for chains beginning with:

```text id="jlwmk4"
KUBE-
```

You'll find chains representing Services, EndpointSlices, and the DNAT rules we've discussed.

If you're using IPVS:

```bash id="jlwm84"
sudo ipvsadm -Ln
```

You'll see virtual Services mapped directly to backend Pods.

If you're using nftables:

```bash id="jlwm12"
sudo nft list ruleset
```

The output is more modern but serves the same purpose: showing how the kernel will process packets.

---

# Following the Rules Yourself

A useful debugging exercise is to compare three things.

First, inspect the Service.

```bash id="jlwmw4"
kubectl get svc backend -n backend
```

Then inspect its EndpointSlice.

```bash id="jlwm19"
kubectl get endpointslices -n backend
```

Finally, inspect the node's networking rules.

Whether you're looking at iptables, IPVS, or nftables, you should be able to connect the dots:

```text id="jlwm11"
Service

↓

ClusterIP

↓

EndpointSlice

↓

Pod IP

↓

Kernel Rules
```

When those pieces agree with each other, Service routing almost always works.

---

# Troubleshooting Checklist

When a Service isn't behaving correctly, follow the packet.

### 1. Does DNS work?

```bash id="jlwmz8"
nslookup backend.backend
```

If DNS fails, the problem is probably CoreDNS rather than kube-proxy.

---

### 2. Does the Service exist?

```bash id="jlwm66"
kubectl get svc -n backend
```

---

### 3. Does the Service have endpoints?

```bash id="jlwm33"
kubectl get endpointslices -n backend
```

An empty EndpointSlice means there are no healthy Pods matching the Service selector.

---

### 4. Is kube-proxy running?

```bash id="jlwm27"
kubectl get pods \
-n kube-system \
-l k8s-app=kube-proxy
```

One kube-proxy Pod should be running on every node.

---

### 5. Inspect the node

If the Service exists and EndpointSlices look correct, inspect the node's packet processing rules.

The problem is often easier to understand from the node's perspective than from inside a Pod.

---

# A Complete Journey

Let's bring everything we've learned across the last three articles together.

```text id="jlwm77"
Application

        │

curl http://backend.backend

        │

        ▼

Linux Resolver

        │

        ▼

CoreDNS

        │

Returns

10.96.18.72

        │

        ▼

Linux Kernel

        │

iptables

IPVS

or nftables

        │

DNAT

        ▼

Backend Pod IP

        │

        ▼

CNI Network

        │

        ▼

Backend Pod

        │

        ▼

HTTP Response
```

Notice how many components quietly cooperate.

* The **kubelet** prepared the Pod's DNS configuration.
* **CoreDNS** translated the Service name into a ClusterIP.
* **EndpointSlices** tracked the backend Pods.
* **kube-proxy** programmed the Linux kernel.
* The **Linux kernel** rewrote the destination address.
* The **CNI** delivered the packet to the correct node and Pod.
* Linux networking handled the return path.

Your application remained blissfully unaware.

It simply called:

```bash id="jlwm55"
curl http://backend.backend
```

---

# Key Takeaways

By now, one of Kubernetes' biggest networking mysteries should feel much less mysterious.

* A **ClusterIP is a virtual IP**, not an address assigned to any Pod or network interface.
* **kube-proxy doesn't proxy traffic**. It programs the Linux networking stack so packets are rewritten automatically.
* Depending on the cluster configuration, kube-proxy uses **iptables**, **IPVS**, or **nftables** to implement Service routing.
* **NodePort** and **LoadBalancer** Services build on top of the same mechanisms rather than replacing them.
* Most Service-related networking issues can be diagnosed by following the packet: DNS → Service → EndpointSlice → kernel rules → Pod.

Once you understand that flow, debugging Kubernetes networking becomes much more systematic.

---

# What's Next?

We've now solved another major puzzle.

A packet destined for a virtual Service IP somehow becomes a packet destined for a real Pod.

But we've quietly skipped over one final step.

Suppose the backend Pod lives on a completely different worker node.

```text id="jlwm90"
Worker Node A

Frontend Pod

──────────────

Worker Node B

Backend Pod
```

How does that packet actually cross the network?

Who creates the routes?

What role does the CNI play?

How do technologies like **VXLAN**, **BGP**, **Geneve**, and **eBPF** fit into the picture?

In the next article, we'll leave kube-proxy behind and dive into the Kubernetes networking fabric itself, following packets across nodes and exploring how different CNIs connect an entire cluster into what appears to be a single flat network.
