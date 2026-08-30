<!-- # How Packets Flow Inside Kubernetes (Part 1)

## Following a Single Packet from `curl http://backend` to the Right Pod

> *"I typed `curl http://backend` inside my frontend Pod. Kubernetes somehow found the right backend Pod, even though I never provided an IP address. How?"*

If you've ever deployed an application to Kubernetes, you've probably done something like this:

```bash
kubectl exec -it deploy/frontend -n frontend -- sh

# Inside the container
curl http://backend.backend
```

A few milliseconds later:

```text
{"message":"Hello from the backend!"}
```

Success.

But what actually happened?

* How did your application know where `backend.backend` lives?
* Where did that hostname come from?
* How did Kubernetes translate it into an IP address?
* Why didn't we need to know which node the backend Pod was running on?
* How did the packet find the correct Pod among multiple replicas?
* And why did the response know exactly how to get back?

Most Kubernetes tutorials stop at:

> "Services provide service discovery."

While that's true, it doesn't explain *how*.

In this article, we'll follow **one single packet** from the moment your application sends it until it reaches the backend Pod. Along the way, we'll meet CoreDNS, Services, EndpointSlices, kube-proxy, and the networking layer that ties everything together.

By the end of this article, you'll no longer think of Kubernetes networking as magic—you'll understand the journey every request takes.

---

# Building Our Playground

To make things concrete, we'll build a small three-tier application.

```
                    Kubernetes Cluster

        ┌──────────────────────────────────────────┐

          frontend Namespace
          ┌─────────────────────────────┐
          │ Frontend Deployment         │
          │ Frontend Service            │
          └─────────────────────────────┘

                     │

          backend Namespace
          ┌─────────────────────────────┐
          │ Backend Deployment          │
          │ Backend Service             │
          └─────────────────────────────┘

                     │

          database Namespace
          ┌─────────────────────────────┐
          │ PostgreSQL Deployment       │
          │ PostgreSQL Service          │
          └─────────────────────────────┘

        └──────────────────────────────────────────┘
```

Each application has:

* its own namespace
* a Deployment
* a ClusterIP Service

The frontend talks to the backend.

The backend talks to PostgreSQL.

Nothing fancy.

Just enough to understand how Kubernetes networking really works.

---

# Creating the Namespaces

```bash
kubectl create namespace frontend
kubectl create namespace backend
kubectl create namespace database
```

---

# Deploy the Backend

For demonstration purposes, we'll use the `hashicorp/http-echo` container.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
      - name: backend
        image: hashicorp/http-echo
        args:
        - "-text=Hello from Backend"
```

Expose it using a ClusterIP Service.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: backend
spec:
  selector:
    app: backend
  ports:
  - port: 80
    targetPort: 5678
```

Notice something interesting.

The Service is also called **backend**.

Remember that.

It's going to become important later.

---

# Deploy the Frontend

We'll use a simple Alpine container.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: frontend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
      - name: frontend
        image: alpine
        command:
        - sleep
        - infinity
```

There's no application running here.

We're simply going to use this Pod as our client.

---

# Verify Everything Is Running

```bash
kubectl get pods -A
```

Example output:

```text
NAMESPACE     NAME

frontend      frontend-8fd95c...
backend       backend-74f7d...
backend       backend-9fd1c...
backend       backend-c7dd9...
database      postgres...
```

Now list the Services.

```bash
kubectl get svc -A
```

You should see something similar to:

```text
NAMESPACE     NAME          TYPE        CLUSTER-IP

backend       backend       ClusterIP   10.96.18.72
database      postgres      ClusterIP   10.96.31.10
```

At this point, we already know something interesting.

The backend Service has an IP address:

```
10.96.18.72
```

Yet we never use it.

Instead, applications usually communicate using:

```text
backend
```

or

```text
backend.backend
```

How does Kubernetes know that `backend` refers to `10.96.18.72`?

That's exactly the mystery we're going to solve.

---

# The Journey Begins

Let's enter the frontend Pod.

```bash
kubectl exec -it deploy/frontend -n frontend -- sh
```

Inside the container, run:

```bash
wget -qO- http://backend.backend
```

or

```bash
curl http://backend.backend
```

The response:

```text
Hello from Backend
```

Simple enough.

But let's pause.

Your application didn't send traffic to:

```
10.96.18.72
```

It didn't send traffic to:

```
10.244.2.15
```

It didn't even know how many backend Pods existed.

It only knew this:

```text
backend.backend
```

Everything else was handled by Kubernetes.

So let's zoom in.

Imagine we're sitting inside the frontend container.

```
Frontend Pod
────────────────────────────────────

Application

curl http://backend.backend

        │
        ▼
Linux Networking Stack

        │
        ▼
?????
```

At this point, your application has one simple question:

> **"What IP address does `backend.backend` belong to?"**

Your application cannot send a packet until it knows the destination IP address.

So before any HTTP request is made...

Before TCP is established...

Before kube-proxy becomes involved...

Before the CNI forwards anything...

Linux has to answer one very important question:

> **"How do I resolve this hostname?"**

That means our journey doesn't begin with Kubernetes.

It begins with **DNS**.

And every Pod in Kubernetes already knows exactly where to send DNS queries.

The next question is:

**Who taught the Pod where to find the cluster's DNS server?**

We'll answer that in the next section by dissecting the Pod's `/etc/resolv.conf`, understanding how the kubelet prepares every container for DNS resolution, and following the request to the cluster's DNS Service.

# How Packets Flow Inside Kubernetes (Part 2)

## Meeting DNS: The Unsung Hero of Kubernetes Networking

At the end of Part 1, our packet had barely left the application.

Our frontend container wanted to send this request:

```bash
curl http://backend.backend
```

But before Linux can send a single packet, it has to answer one simple question:

> **What IP address is `backend.backend`?**

Applications don't resolve DNS themselves. Instead, they ask the operating system:

> "Can you please find the IP address for this hostname?"

So where does Linux go to find that answer?

The answer is hidden in a file that exists inside **every** Pod.

---

# Looking Inside `/etc/resolv.conf`

Let's inspect it.

```bash
kubectl exec -it deploy/frontend -n frontend -- cat /etc/resolv.conf
```

You'll likely see something similar to this:

```text
search frontend.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5
```

This tiny file is responsible for almost every DNS lookup inside your cluster.

Let's break it down.

---

# `nameserver`

```text
nameserver 10.96.0.10
```

This tells Linux:

> "Whenever you need to resolve a hostname, send the DNS query to **10.96.0.10**."

Notice that this isn't the IP address of a CoreDNS Pod.

Instead, it's the ClusterIP of a Kubernetes Service.

Let's verify it.

```bash
kubectl get svc -n kube-system
```

Example output:

```text
NAME       TYPE        CLUSTER-IP
kube-dns   ClusterIP   10.96.0.10
```

This surprises many people.

Most assume Pods communicate directly with CoreDNS.

They don't.

Pods always talk to the **`kube-dns` Service**.

Just like your frontend communicates with the `backend` Service instead of directly contacting backend Pods, every Pod in the cluster communicates with the `kube-dns` Service instead of directly contacting CoreDNS Pods.

This is a recurring Kubernetes design pattern:

```text
Application
      │
      ▼
 Service
      │
      ▼
 One or More Pods
```

Whether it's your application, CoreDNS, or even the Kubernetes API server, Services provide a stable endpoint while the Pods behind them can be created, destroyed, or rescheduled at any time.

---

# Wait... Why Is the Service Called `kube-dns` If We're Using CoreDNS?

Good question.

If you inspect the Pods:

```bash
kubectl get pods -n kube-system
```

You'll probably see something like this:

```text
NAME
coredns-7b6c8...
coredns-7b6c8...
```

But the Service is still named:

```text
kube-dns
```

This is for backward compatibility.

Years ago, Kubernetes used a DNS server called **kube-dns**. When CoreDNS replaced it as the default DNS server, the Service name remained the same so that existing clusters and applications didn't need to change.

Today, the `kube-dns` Service simply forwards traffic to the CoreDNS Pods.

You can verify this relationship:

```bash
kubectl describe svc kube-dns -n kube-system
```

Near the bottom you'll see something like:

```text
Endpoints:
10.244.0.8:53
10.244.1.12:53
```

Those endpoint IPs belong to the CoreDNS Pods.

The flow now looks like this:

```text
Frontend Pod
       │
       │ DNS Query
       ▼
kube-dns Service
       │
       ▼
CoreDNS Pod
```

---

# The `search` Directive

Now let's look at the first line.

```text
search frontend.svc.cluster.local svc.cluster.local cluster.local
```

This is one of the coolest features of Kubernetes DNS.

Suppose your application requests:

```text
backend
```

That's not a fully qualified domain name (FQDN).

Normally, DNS wouldn't know what `backend` means.

Instead of immediately failing, Linux automatically tries several possibilities using the search domains.

It effectively asks:

```text
backend.frontend.svc.cluster.local
```

Does it exist?

If not:

```text
backend.svc.cluster.local
```

Still no?

Finally:

```text
backend.cluster.local
```

This is why applications in the **same namespace** can simply use:

```text
backend
```

without specifying the namespace.

---

# Talking to Services in Another Namespace

Our backend Service isn't in the `frontend` namespace.

It's inside the `backend` namespace.

So this won't work:

```text
backend
```

Linux expands it to:

```text
backend.frontend.svc.cluster.local
```

But no Service with that name exists.

Instead, we specify the namespace:

```text
backend.backend
```

Now Linux expands it into:

```text
backend.backend.svc.cluster.local
```

And suddenly everything makes sense.

Let's break that hostname apart:

```text
backend.backend.svc.cluster.local
│        │
│        └── Namespace
│
└──────────── Service Name
```

The remaining parts identify the object as a Kubernetes Service within the cluster's DNS domain.

Putting it all together:

```text
<Service>.<Namespace>.svc.cluster.local
```

This is the canonical DNS name for a Service.

---

# What Is `cluster.local`?

Every Kubernetes cluster has a DNS suffix.

By default, it's:

```text
cluster.local
```

So the complete DNS name for our backend Service is:

```text
backend.backend.svc.cluster.local
```

But this isn't a hard requirement.

Cluster administrators can choose a different domain when creating the cluster.

For example:

```text
backend.backend.svc.ochuko.internal
```

or

```text
backend.backend.svc.production.local
```

Changing the cluster domain is uncommon because many tools assume `cluster.local`, but it's entirely configurable.

We'll see where this value comes from and how to change it in the next article when we dive into CoreDNS.

---

# Understanding `ndots`

The final line is the one most people ignore.

```text
options ndots:5
```

It's also one of the most misunderstood.

`ndots` controls when Linux treats a name as "already complete."

A hostname containing fewer than five dots is considered *relative*, so Linux tries the search domains first.

For example:

```text
backend
```

has zero dots.

Linux appends the search domains.

Likewise:

```text
backend.backend
```

has one dot.

Still fewer than five.

Again, Linux appends the search domains.

Even this:

```text
backend.backend.svc.cluster.local
```

contains four dots.

Linux still treats it as relative because `ndots` is set to five.

Only names with five or more dots—or names ending with a trailing period like:

```text
backend.backend.svc.cluster.local.
```

are considered absolute and queried directly.

Why does this matter?

Because every failed lookup generates additional DNS requests.

If your application repeatedly queries external domains like:

```text
api.github.com
```

Linux may first try:

```text
api.github.com.frontend.svc.cluster.local
```

then

```text
api.github.com.svc.cluster.local
```

before finally asking for:

```text
api.github.com
```

That's several unnecessary DNS lookups.

Understanding `ndots` becomes important when optimizing application startup times and reducing DNS traffic in large clusters.

---

# Who Created `/etc/resolv.conf`?

Here's another interesting question.

Did your container image include this file?

No.

Even if you build your own image, Kubernetes replaces or generates the DNS configuration when the Pod starts.

The component responsible is the **kubelet**.

When the kubelet prepares a Pod, it configures networking, mounts volumes, and generates DNS settings before the container process begins.

Among those settings is the `resolv.conf` file that tells every application where DNS queries should be sent.

In other words, your application didn't need to know anything about CoreDNS.

The kubelet prepared the environment before your application ever started.

---

# Following the Packet

Let's update our journey.

```text
Frontend Pod
      │
Application
      │
curl http://backend.backend
      │
      ▼
Linux checks /etc/resolv.conf
      │
      ▼
DNS query sent to
10.96.0.10
(kube-dns Service)
      │
      ▼
CoreDNS Pod
      │
      ▼
???
```

We've arrived at the DNS server.

Now the real question begins.

How does CoreDNS already know about every Service, every namespace, and every Endpoint in the cluster?

Surely it isn't asking the Kubernetes API server for every single DNS query—that would be far too slow.

In the next part, we'll step inside CoreDNS itself, uncover how it watches the Kubernetes API in real time, why it rarely needs to query the API server directly, and how it transforms a Service name like `backend.backend` into the virtual IP that the rest of Kubernetes networking is built upon.

# How Packets Flow Inside Kubernetes (Part 3)

## How CoreDNS Knows Every Service in Your Cluster

At the end of Part 2, our DNS query had finally reached CoreDNS.

Our packet's journey now looks like this:

```text
Frontend Pod
      │
Application
      │
curl http://backend.backend
      │
      ▼
Linux Resolver
(/etc/resolv.conf)
      │
      ▼
kube-dns Service
      │
      ▼
CoreDNS
      │
      ▼
???
```

Now we have a new mystery.

Our cluster could contain:

* 50 Services
* 500 Services
* 5,000 Services

Yet CoreDNS instantly knows that:

```text
backend.backend
```

refers to the backend Service.

How?

Does it ask the Kubernetes API Server every single time?

Thankfully...

**No.**

If it did, your applications would become painfully slow.

Imagine every `curl`, every HTTP request, every database connection first waiting for CoreDNS to make an API request to the control plane.

That would quickly overwhelm the API Server.

Instead, Kubernetes uses a much smarter approach.

---

# CoreDNS Doesn't Search. It Watches.

One of the most important ideas in Kubernetes is the **watch** mechanism.

Instead of repeatedly asking:

> "Has anything changed?"

components tell the API Server:

> "Notify me whenever something changes."

This is called a **Watch**.

CoreDNS uses it extensively.

When a CoreDNS Pod starts, it opens a long-lived connection to the Kubernetes API Server.

```text
CoreDNS
     │
     │ Watch Services
     │ Watch EndpointSlices
     │ Watch Namespaces
     ▼
Kubernetes API Server
```

Now imagine someone creates a new Service.

```bash
kubectl expose deployment payments
```

The API Server immediately tells CoreDNS:

> "A new Service named `payments` now exists."

No polling.

No repeated API requests.

Just an event.

The same thing happens when:

* a Service is deleted
* a Pod crashes
* a Deployment scales
* EndpointSlices change
* a Namespace is created

CoreDNS continuously receives updates as they happen.

---

# The Local Cache

Receiving events is only half the story.

CoreDNS also stores these objects **in memory**.

Think of it like this.

```text
API Server

Services
Pods
EndpointSlices
Namespaces

        │
        │ Watch Events
        ▼

CoreDNS Memory

✓ backend
✓ postgres
✓ frontend
✓ payments
✓ users
✓ redis
```

Instead of asking the API Server every DNS request,

CoreDNS simply looks inside its own memory.

Memory lookups take microseconds.

Network requests take milliseconds.

That difference is enormous.

---

# Let's Prove It

Suppose we create a new Service.

```bash
kubectl expose deployment nginx \
    --port=80
```

A few moments later,

without restarting CoreDNS,

this suddenly works:

```bash
nslookup nginx
```

Why?

Because CoreDNS received an event from the API Server and updated its cache automatically.

---

# What Happens When CoreDNS Receives Our Query?

Let's replay our request.

```text
backend.backend
```

CoreDNS now asks itself:

> "Do I know about a Service named backend in the backend namespace?"

It checks its cache.

```text
Memory Cache

Namespace: backend

Service:
backend

ClusterIP:
10.96.18.72

Selector:
app=backend
```

It finds a match almost instantly.

Notice something important.

CoreDNS does **not** return a Pod IP.

Instead, it returns:

```text
10.96.18.72
```

That isn't any Pod's address.

It's the **ClusterIP** of the Service.

---

# Wait... Why Not Return the Backend Pod?

Remember that our Deployment has three replicas.

```text
backend

Pod A
10.244.1.18

Pod B
10.244.2.7

Pod C
10.244.3.21
```

If DNS returned one of these addresses,

what would happen if Pod B crashed?

Every application would continue trying to connect to an IP that no longer exists.

Instead,

CoreDNS always returns the Service's stable virtual IP.

```text
backend.backend

↓

10.96.18.72
```

That address never changes, even if Pods are created, deleted, or moved to different nodes.

This is one of the biggest advantages of Kubernetes Services.

Applications don't care where Pods live.

They only need the Service address.

---

# So How Does the Service Know About the Pods?

Excellent question.

Services don't magically discover Pods.

Instead, Kubernetes continuously builds another object called an **EndpointSlice**.

Let's inspect ours.

```bash
kubectl get endpointslices -n backend
```

Example:

```text
NAME

backend-kj82m
```

Describe it.

```bash
kubectl describe endpointslice backend-kj82m -n backend
```

You'll see something similar to:

```text
Addresses:

10.244.1.18

10.244.2.7

10.244.3.21
```

These are the actual backend Pods.

Notice what happened.

```text
Service

backend

↓

EndpointSlice

10.244.1.18

10.244.2.7

10.244.3.21
```

The Service itself doesn't store Pod IPs.

Instead,

it points to one or more EndpointSlices,

and those EndpointSlices contain the real Pod addresses.

---

# Where Do EndpointSlices Come From?

You never created one.

Kubernetes did.

Behind the scenes, one of the control plane components continuously watches your cluster.

Whenever Pods matching a Service selector appear,

it updates the corresponding EndpointSlice.

For example,

our Service selector is:

```yaml
selector:
  app: backend
```

Whenever a Pod appears with:

```yaml
labels:
  app: backend
```

the EndpointSlice is automatically updated.

Scale the Deployment:

```bash
kubectl scale deployment backend \
    --replicas=6
```

Now inspect the EndpointSlice again.

You'll see six Pod addresses.

Scale back down.

The extra Pod IPs disappear.

You never touched the EndpointSlice yourself.

Kubernetes maintained it for you.

---

# The Journey So Far

Let's update our packet's journey again.

```text
Frontend Pod

        │

curl backend.backend

        │

        ▼

Linux Resolver

        │

        ▼

kube-dns Service

        │

        ▼

CoreDNS

        │

Looks up Service

        │

Returns

10.96.18.72

(Service ClusterIP)

        │

        ▼

HTTP Request

Destination:

10.96.18.72

        │

        ▼

???
```

We're finally sending an HTTP request.

But another mystery appears.

The destination IP is:

```text
10.96.18.72
```

There is no Pod with that address.

Run this command:

```bash
kubectl get pods -A -o wide
```

You'll never find it.

Because **10.96.18.72 isn't real.**

Well...

Not in the traditional sense.

It's a **virtual IP** created by Kubernetes.

So who intercepts packets destined for this virtual address and redirects them to one of the backend Pods listed in the EndpointSlice?

That's where one of Kubernetes' most important networking components enters the story:

**kube-proxy.**

We intentionally won't dive deep into kube-proxy's internals here—that deserves an article of its own—but we do need to understand its role in completing our packet's journey.

---

# kube-proxy: The Traffic Director

Every node in a Kubernetes cluster runs a kube-proxy instance.

Its job is surprisingly simple:

> Watch Services and EndpointSlices, then program the node's networking stack so packets sent to a Service IP are transparently redirected to one of the backing Pods.

Conceptually, it looks like this:

```text
HTTP Request

Destination:

10.96.18.72

        │

        ▼

kube-proxy

        │

Chooses

10.244.2.7

        │

        ▼

Packet rewritten

Destination:

10.244.2.7
```

From your application's perspective, it still thinks it's talking to `10.96.18.72`.

Behind the scenes, kube-proxy has quietly rewritten the destination before the packet leaves the node.

How does it perform that rewrite?

Using technologies like:

* iptables
* IPVS
* nftables (newer Kubernetes versions)

We'll dedicate an entire article to those mechanisms later in the series.

For now, it's enough to understand that kube-proxy is the bridge between the **virtual world of Services** and the **real world of Pod IP addresses**.

Our packet is now only one step away from reaching its destination.

In the final part of this article, we'll watch it arrive at the backend Pod, follow the response all the way back to the frontend, explain the mysterious `kubernetes` Service that exists in every cluster, and finish with practical debugging techniques that you'll use whenever Kubernetes networking doesn't behave the way you expect.

# How Packets Flow Inside Kubernetes (Part 4)

## The Packet Arrives, The Response Returns, and Putting It All Together

By now, our packet has traveled surprisingly far.

Let's recap its journey.

```text
                    Kubernetes Cluster

┌───────────────────────────────────────────────────────────────┐

Frontend Pod
│
│ curl http://backend.backend
│
▼
Linux DNS Resolver
│
▼
/etc/resolv.conf
│
▼
kube-dns Service (10.96.0.10)
│
▼
CoreDNS
│
▼
Returns Service IP
10.96.18.72
│
▼
HTTP Request
Destination = 10.96.18.72
│
▼
kube-proxy
│
▼
Packet rewritten
Destination = 10.244.2.7
│
▼
Backend Pod

└───────────────────────────────────────────────────────────────┘
```

We're almost there.

The only thing left is for the backend Pod to receive the request, process it, and send the response back.

---

# The Packet Finally Reaches the Backend Pod

Remember the IP chosen by kube-proxy?

```text
10.244.2.7
```

That's a real Pod IP.

From this point onward, Kubernetes has finished making decisions.

The packet simply travels like any normal Linux network packet.

Depending on where the backend Pod is running, one of two things happens.

## Scenario 1 — Same Node

```
Worker Node 1

Frontend Pod
10.244.1.5

        │

Linux Bridge

        │

Backend Pod
10.244.1.9
```

The packet never leaves the node.

It simply crosses the Linux bridge (or whatever networking implementation your CNI provides) and arrives at the backend Pod.

This is the fastest possible path.

---

## Scenario 2 — Different Nodes

```
                 Worker 1
─────────────────────────────────

Frontend Pod
10.244.1.5

        │

CNI

        │

══════════ Network ══════════

        │

CNI

        │

Backend Pod
10.244.2.7

─────────────────────────────────
                 Worker 2
```

If the backend lives on another node, your Container Network Interface (CNI) takes over.

Depending on which CNI you're using, it might use:

* VXLAN
* Geneve
* Native routing
* BGP
* eBPF

to transport the packet across the cluster.

We're deliberately treating the CNI as a black box in this article because we'll dedicate an entire future article to how packets cross nodes.

For now, what's important is this:

> Once kube-proxy has chosen the destination Pod, the CNI is responsible for getting the packet there.

---

# The Backend Responds

Our backend receives the HTTP request.

```
GET /
```

Processes it.

Then sends:

```
HTTP/1.1 200 OK

Hello from Backend
```

Now another question arises.

How does the backend know where to send the response?

The answer is surprisingly simple.

It doesn't need Kubernetes.

Every TCP packet contains:

* Source IP
* Destination IP

When the frontend sent the request, the packet looked roughly like this:

```
Source:
10.244.1.5

Destination:
10.244.2.7
```

When the backend replies, Linux simply swaps them.

```
Source:
10.244.2.7

Destination:
10.244.1.5
```

The response follows the exact same network path in reverse until it reaches the frontend Pod.

From the application's perspective, everything looks completely normal.

```bash
curl http://backend.backend
```

↓

```text
Hello from Backend
```

No magic.

Just networking.

---

# The Mysterious `kubernetes` Service

If you've ever listed Services, you've probably noticed something strange.

```bash
kubectl get svc -A
```

Example:

```text
NAMESPACE     NAME

default       kubernetes
backend       backend
database      postgres
```

Why is there always a Service named:

```
kubernetes
```

inside the **default** namespace?

Let's inspect it.

```bash
kubectl describe svc kubernetes
```

Example output:

```text
Name: kubernetes

Type: ClusterIP

IP:
10.96.0.1

Endpoints:
192.168.56.10:6443
```

Notice something interesting.

The endpoint isn't a Pod.

It's actually your Kubernetes API Server.

That means every Pod inside the cluster can access the API Server using:

```
https://kubernetes.default.svc.cluster.local
```

Instead of needing to know the API Server's actual IP address.

This is incredibly useful.

Imagine writing an application that needs to communicate with Kubernetes.

Instead of configuring:

```
https://192.168.56.10:6443
```

you simply connect to:

```
https://kubernetes.default.svc
```

Every official Kubernetes client library does exactly this.

In fact, if you've ever used the Go Kubernetes client without specifying a server address, this is how it finds the API Server.

---

# Let's Prove It

Inside any Pod:

```bash
kubectl exec -it deploy/frontend -n frontend -- sh
```

Look at the automatically injected environment variables.

```bash
env | grep KUBERNETES
```

You'll probably see something similar to:

```text
KUBERNETES_SERVICE_HOST=10.96.0.1

KUBERNETES_SERVICE_PORT=443
```

Those values come from the `kubernetes` Service.

They allow applications running inside the cluster to discover and communicate with the Kubernetes API automatically.

---

# Debugging Service Discovery

When something goes wrong, resist the temptation to restart Pods immediately.

Instead, walk through the packet's journey.

## Step 1

Can the application resolve DNS?

```bash
nslookup backend.backend
```

If this fails:

* CoreDNS
* kube-dns Service
* DNS policy
* `/etc/resolv.conf`

are the first places to investigate.

---

## Step 2

Does the Service exist?

```bash
kubectl get svc -n backend
```

---

## Step 3

Does the Service have endpoints?

```bash
kubectl get endpoints -n backend
```

or

```bash
kubectl get endpointslices -n backend
```

If there are no endpoints,

your selector probably doesn't match any Pods.

---

## Step 4

Are the Pods healthy?

```bash
kubectl get pods -n backend -o wide
```

---

## Step 5

Inspect CoreDNS.

```bash
kubectl get pods -n kube-system

kubectl logs -n kube-system deploy/coredns
```

---

## Step 6

Inspect the CoreDNS configuration.

```bash
kubectl edit configmap coredns -n kube-system
```

Don't worry if most of it looks unfamiliar.

We'll explain every single line in the next article.

---

# Breaking Things (Safely)

One of the best ways to understand Kubernetes is to deliberately break it.

Here are a few experiments you can try in a development cluster.

### Delete the backend Service

```bash
kubectl delete svc backend -n backend
```

Now run:

```bash
curl http://backend.backend
```

Expected result:

DNS lookup fails because the Service no longer exists.

---

### Scale the Deployment to Zero

```bash
kubectl scale deployment backend \
--replicas=0
```

Now inspect the EndpointSlice.

```bash
kubectl get endpointslices -n backend
```

Notice that the list of addresses becomes empty.

The Service still exists.

DNS still resolves.

But there are no backend Pods available to receive traffic.

---

### Restart CoreDNS

```bash
kubectl rollout restart deployment coredns \
-n kube-system
```

Watch how Kubernetes recreates the Pods.

Because applications communicate through the stable `kube-dns` Service rather than directly with CoreDNS Pods, DNS service quickly recovers without clients needing to know about the new Pod IPs.

---

# The Journey of a Packet

Let's put everything we've learned together.

```text
Application
      │
      │ curl http://backend.backend
      ▼
Linux Resolver
      │
      ▼
/etc/resolv.conf
      │
      ▼
kube-dns Service
      │
      ▼
CoreDNS
      │
      ▼
Returns ClusterIP
      │
      ▼
Service
      │
      ▼
EndpointSlice
      │
      ▼
kube-proxy
      │
      ▼
Backend Pod
      │
      ▼
HTTP Response
      │
      ▼
Frontend Pod
```

That entire journey typically happens in just a few milliseconds.

Yet behind those milliseconds, dozens of Kubernetes components quietly cooperate:

* The **kubelet** prepared the Pod's DNS configuration.
* **CoreDNS** translated a Service name into a ClusterIP.
* The **EndpointSlice** tracked which Pods belonged to the Service.
* **kube-proxy** redirected traffic to one of those Pods.
* Your **CNI** delivered the packet across the node—or even across the cluster.
* Linux networking handled the return path.

Your application never needed to know about any of it.

It simply called:

```bash
curl http://backend.backend
```

---

# What's Next?

In this article, we treated CoreDNS like a black box.

We know it answers DNS queries.

But we skipped over the most interesting part:

* How does CoreDNS learn about new Services?
* Why doesn't it query the API Server for every DNS request?
* What does every line in the CoreDNS ConfigMap actually do?
* What is the `kubernetes` plugin?
* What do the `cache`, `forward`, `loop`, `reload`, `ready`, and `health` plugins do?
* How does Kubernetes resolve names like `google.com` differently from `backend.backend`?
* What happens when DNS breaks, and how do you fix it?

In the next article, we'll open the hood on CoreDNS itself and trace every DNS query from the moment it enters the DNS server until an answer is returned. By the end, you'll understand not just **that** Kubernetes DNS works, but **how** it works internally—and you'll be confident enough to debug and customize it in your own clusters. -->
