---
title: "Building a Kubernetes CNI From Scratch (Part 5): Understanding Network Policies With iptables"
description: "Our CNI now connects every Pod in the cluster. In this article, we explore Kubernetes NetworkPolicies, inspect how Linux forwards Pod traffic, and manually enforce traffic restrictions with iptables."
date: "2026-07-11"
tags: "Kubernetes, CNI, NetworkPolicy, iptables, Linux Networking, Security, Platform Engineering, Cloud Native"
cover: "/blog/cni-01/image-01.png"
published: false
order: 5
series: "Building a Kubernetes CNI From Scratch"
seriesOrder: 5
---

In Part 4, we completed the basic networking layer of our CNI.

Pods can now communicate with:

- other Pods on the same node
- Pods running on different nodes
- the host node
- the control-plane node
- external networks, assuming forwarding and NAT are configured

From a connectivity perspective, everything works.

But that introduces a new problem.

Everything works.

A frontend Pod can connect directly to the database.

A monitoring Pod can contact an internal backend.

A compromised workload can scan every Pod IP in the cluster.

A Pod in the `development` namespace can communicate with workloads in `production`.

By default, Kubernetes follows an **allow-all networking model**. Unless the CNI implements NetworkPolicy enforcement, Pods can generally communicate with every other reachable Pod.

Connectivity alone is therefore not enough.

A useful CNI must eventually answer two different questions:

1. **How can this packet reach its destination?**
2. **Should this packet be allowed to reach its destination?**

The networking layer we built in Parts 3 and 4 answers the first question.

Network policies answer the second.

In this article, we will not build our Network Policy Controller yet.

Instead, we will understand:

- what Kubernetes NetworkPolicies describe
- how Pods become isolated
- how label selectors become IP-based rules
- how Linux sees traffic moving between Pods
- how `iptables` can permit or reject that traffic
- why a controller must continuously update rules as Pods change

We will also build a small application environment consisting of frontend, backend, and database workloads, prove that everything can initially communicate, and then manually apply `iptables` rules on our worker nodes.

The goal is to understand the enforcement mechanism before automating it.


## NetworkPolicy Is Only a Kubernetes Object

A Kubernetes NetworkPolicy is a declaration of allowed traffic.

For example, a policy may say:

> Only Pods labelled `role=frontend` may send traffic to Pods labelled `role=backend` on TCP port 8080.

Another policy may say:

> Only backend Pods may connect to the database on TCP port 5432.

Kubernetes stores these declarations through the API Server like every other Kubernetes object.

But the API Server does not enforce them.

The scheduler does not enforce them.

The kubelet does not normally build firewall rules from them.

The NetworkPolicy object only describes the desired state.

Something running on the nodes must translate that desired state into real packet-filtering rules.

That component is usually provided by the CNI.

In our implementation, we will eventually build a **Network Policy Controller** that runs on every node as a DaemonSet.

Each controller instance will:

- watch NetworkPolicy objects
- watch Pods and their labels
- watch Namespaces and their labels
- determine which local Pods are selected
- resolve selected Pods into IP addresses
- create or remove `iptables` rules on its node

The relationship will look like this:

```text
NetworkPolicy YAML
        |
        v
Kubernetes API Server
        |
        v
Network Policy Controller
        |
        v
Resolve labels into Pod IPs
        |
        v
Create iptables rules
        |
        v
Linux allows or blocks packets
````

The NetworkPolicy itself does not block anything.

Linux does.


## How Kubernetes NetworkPolicies Select Workloads

NetworkPolicies do not normally refer directly to Pod IP addresses.

Pod IPs are temporary.

A Pod may be deleted and recreated with a different address. Deployments can scale up or down. Pods can move between nodes.

Instead, NetworkPolicies use labels.

Suppose we have a backend Deployment with:

```yaml
labels:
  app: backend
  role: backend
```

A NetworkPolicy can select those Pods using:

```yaml
podSelector:
  matchLabels:
    role: backend
```

The policy engine must then ask Kubernetes:

> Which currently running Pods have the label `role=backend`?

Suppose Kubernetes returns:

```text
10.244.1.3
10.244.1.4
10.244.2.2
```

The policy controller can now create firewall rules for those addresses.

This translation is continuous.

If one backend Pod is deleted and a new one appears at `10.244.2.8`, the controller must remove the stale IP and add the new one.

This is why policy enforcement cannot live only inside the short-lived CNI `ADD` operation.

The CNI executable is invoked when a Pod is created or deleted.

NetworkPolicies, labels, Pods, and Namespace membership can change long after that call completes.

We need a long-running controller.


## Ingress and Egress

Kubernetes NetworkPolicies control two directions of traffic.

### Ingress

Ingress means traffic entering a selected Pod.

For example:

```text
Frontend -----> Backend
                ^^^^^^^
                ingress
```

An ingress policy applied to the backend controls who is allowed to connect to it.

### Egress

Egress means traffic leaving a selected Pod.

For example:

```text
Backend -----> Database
^^^^^^^
egress
```

An egress policy applied to the backend controls which destinations it may contact.

A policy may control:

* ingress only
* egress only
* both ingress and egress

It is important to reason from the perspective of the Pod selected by the policy.


## When Does a Pod Become Isolated?

A Pod is not isolated for ingress merely because NetworkPolicies exist somewhere in the cluster.

It becomes isolated for ingress when at least one ingress NetworkPolicy selects that Pod.

Likewise, a Pod becomes isolated for egress when at least one egress NetworkPolicy selects it.

After isolation begins, the allowed traffic is the union of the rules from every policy selecting that Pod.

This creates an important behaviour.

Suppose no policy selects the backend.

```text
Frontend -----> Backend       Allowed
Monitoring ---> Backend       Allowed
Random Pod ---> Backend       Allowed
```

Now we create an ingress policy that selects the backend and allows only frontend Pods.

The backend becomes ingress-isolated.

```text
Frontend -----> Backend       Allowed
Monitoring ---> Backend       Denied
Random Pod ---> Backend       Denied
```

The policy is not simply adding one allow rule to an allow-all environment.

Selecting the Pod changes the default for that traffic direction from allow to deny, and the policy rules describe the exceptions.


## What Is a Default-Deny Policy?

A default-deny policy selects Pods but contains no allow rules.

For example:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
```

The empty selector:

```yaml
podSelector: {}
```

selects every Pod in the policy's namespace.

Because the policy declares `Ingress` but defines no ingress rules, no incoming traffic is allowed to those Pods.

Conceptually:

```text
Any source -----> Any Pod in production
                  Denied
```

This policy is namespaced.

It does not select Pods outside `production`.

To deny both incoming and outgoing traffic, we could use:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

There are no `ingress` or `egress` allow rules, so selected Pods are isolated in both directions.

In our manual lab, we will recreate part of this behaviour using `iptables`.


## Building the Lab Environment

We are going to create three namespaces:

```text
frontend
backend
database
```

Each namespace will contain a three-replica Deployment.

The frontend Pods will act as clients.

The backend Pods will run nginx so we can make HTTP requests to them.

The database Pods will also run nginx for this networking demonstration. We are testing packet flow, not building a real database system yet.

We will also create Services so that workloads can be reached through stable DNS names.

Our intended application flow is:

```text
Frontend
    |
    | TCP 80
    v
Backend
    |
    | TCP 80
    v
Database
```

Initially, Kubernetes will allow all of the following:

```text
Frontend ------> Backend
Frontend ------> Database
Backend -------> Database
Database ------> Backend
```

We will then use Linux firewall rules to restrict those paths manually.


## Creating the Namespaces

Create a file called:

```text
namespaces.yaml
```

Add:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: frontend
  labels:
    environment: cni-lab
    layer: frontend
apiVersion: v1
kind: Namespace
metadata:
  name: backend
  labels:
    environment: cni-lab
    layer: backend
apiVersion: v1
kind: Namespace
metadata:
  name: database
  labels:
    environment: cni-lab
    layer: database
```

Apply it:

```bash
kubectl apply -f namespaces.yaml
```

Verify:

```bash
kubectl get namespaces --show-labels
```

You should see:

```text
NAME       STATUS   LABELS
frontend   Active   environment=cni-lab,layer=frontend
backend    Active   environment=cni-lab,layer=backend
database   Active   environment=cni-lab,layer=database
```

The labels will become useful later when our policies begin using `namespaceSelector`.


## Creating the Frontend Deployment

Create:

```text
frontend.yaml
```

Add:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: frontend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: frontend
      role: client
  template:
    metadata:
      labels:
        app: frontend
        role: client
    spec:
      containers:
        - name: client
          image: curlimages/curl:latest
          command:
            - sh
            - -c
            - sleep infinity
```

Apply it:

```bash
kubectl apply -f frontend.yaml
```

The frontend does not need to expose a port.

It will remain running so we can execute `curl` commands from inside it.


## Creating the Backend Deployment and Service

Create:

```text
backend.yaml
```

Add:

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
      role: api
  template:
    metadata:
      labels:
        app: backend
        role: api
    spec:
      containers:
        - name: backend
          image: nginx:alpine
          ports:
            - name: http
              containerPort: 80
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: backend
spec:
  selector:
    app: backend
    role: api
  ports:
    - name: http
      port: 80
      targetPort: 80
```

Apply it:

```bash
kubectl apply -f backend.yaml
```

The Service can be reached from other namespaces using:

```text
backend.backend.svc.cluster.local
```

or the shorter name:

```text
backend.backend
```


## Creating the Database Deployment and Service

Create:

```text
database.yaml
```

Add:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: database
  namespace: database
spec:
  replicas: 3
  selector:
    matchLabels:
      app: database
      role: datastore
  template:
    metadata:
      labels:
        app: database
        role: datastore
    spec:
      containers:
        - name: database
          image: nginx:alpine
          ports:
            - name: database-demo
              containerPort: 80
apiVersion: v1
kind: Service
metadata:
  name: database
  namespace: database
spec:
  selector:
    app: database
    role: datastore
  ports:
    - name: database-demo
      port: 80
      targetPort: 80
```

Apply it:

```bash
kubectl apply -f database.yaml
```


## Confirming the Workloads Are Running

Check every namespace:

```bash
kubectl get pods -n frontend -o wide
kubectl get pods -n backend -o wide
kubectl get pods -n database -o wide
```

Example:

```text
NAME                        READY   STATUS    IP            NODE
frontend-6d8c7f8b7c-a1b2c   1/1     Running   10.244.1.2    worker-1
frontend-6d8c7f8b7c-d3e4f   1/1     Running   10.244.2.2    worker-2
frontend-6d8c7f8b7c-g5h6i   1/1     Running   10.244.1.3    worker-1
```

Your exact Pod names, addresses, and nodes will be different.

Now display the backend and database IPs:

```bash
kubectl get pods -n backend -o wide
kubectl get pods -n database -o wide
```

Keep those addresses nearby.

When we begin inspecting `iptables`, it will be important to know which destination IP belongs to each workload.


## Proving That Everything Is Initially Allowed

Select one frontend Pod:

```bash
FRONTEND_POD=$(kubectl get pod \
  -n frontend \
  -l app=frontend \
  -o jsonpath='{.items[0].metadata.name}')
```

Enter it:

```bash
kubectl exec -it \
  -n frontend \
  "$FRONTEND_POD" \
  -- sh
```

From inside the frontend Pod, call the backend:

```bash
curl -I http://backend.backend
```

You should receive an HTTP response similar to:

```text
HTTP/1.1 200 OK
Server: nginx
```

Now call the database:

```bash
curl -I http://database.database
```

That should also work.

Exit the frontend Pod:

```bash
exit
```

Now select a database Pod:

```bash
DATABASE_POD=$(kubectl get pod \
  -n database \
  -l app=database \
  -o jsonpath='{.items[0].metadata.name}')
```

Enter it:

```bash
kubectl exec -it \
  -n database \
  "$DATABASE_POD" \
  -- sh
```

Try reaching the backend:

```bash
wget -S -O- http://backend.backend
```

This also works.

At the moment, our cluster network behaves like this:

```text
frontend namespace
        |
        | allowed
        v
backend namespace
        |
        | allowed
        v
database namespace
```

But the reverse paths also work:

```text
database ------> backend       Allowed
database ------> frontend      Allowed if a frontend port is listening
frontend ------> database      Allowed
any Pod -------> any Pod       Generally allowed
```

Our CNI provides connectivity, but it has no security policy.

In the next chunk, we will inspect the Linux packet path, understand the `INPUT`, `OUTPUT`, and `FORWARD` chains, and begin blocking Pod traffic manually with `iptables`.

```
```

````markdown
## How Linux Actually Blocks Packets
So far we've been talking about Kubernetes NetworkPolicies.
But Linux has absolutely no idea what a NetworkPolicy is.
It doesn't understand:
```yaml
podSelector:
````
It doesn't understand:
```yaml
namespaceSelector:
```
It doesn't understand labels.
It doesn't even know Kubernetes exists.
Linux only sees packets.
Every packet has:
* a source IP
* a destination IP
* a protocol
* a destination port
That's all.
So somewhere, our Network Policy Controller must translate Kubernetes objects into something Linux understands.
That "something" is `iptables`.
## What is iptables?
`iptables` is Linux's built-in packet filtering framework.
Think of it as a programmable firewall.
Whenever a packet arrives at a Linux machine, the kernel asks:
> "Should I accept this packet?"
> "Should I reject it?"
> "Should I forward it?"
iptables answers those questions.
For example, you can tell Linux:
```
Allow SSH.

Block HTTP.

Drop packets from 192.168.1.20.

Reject packets destined for 10.244.1.3.
```
Those are all firewall rules.
Kubernetes NetworkPolicies eventually become hundreds—or even thousands—of rules just like these.
## Understanding iptables Tables
iptables is organized into tables.
For networking, the most important one is:
```
filter
```
The filter table contains three chains that we'll care about.
```
INPUT

OUTPUT

FORWARD
```
Each chain represents a different stage in a packet's journey.
## INPUT
The INPUT chain handles packets whose final destination is **the node itself**.
For example:
```
Laptop

↓

Worker Node SSH
```
or
```
API Server

↓

Kubelet
```
Those packets terminate on the host.
They never enter a Pod.
## OUTPUT
The OUTPUT chain handles packets generated by the node itself.
For example:
```
Worker Node

↓

Internet
```
or
```
Worker Node

↓

API Server
```
Again, Pods are not involved.
## FORWARD
The FORWARD chain is the one we care about most.
Packets travelling **through** the node pass through FORWARD.
For example:
```
Pod A

↓

Worker-1

↓

Pod B
```
or
```
Pod

↓

Internet
```
or
```
Worker-2

↓

Pod
```
The host isn't the destination.
It's simply forwarding packets.
That means Pod traffic usually traverses the FORWARD chain.
This is exactly where our future Network Policy Controller will install most of its rules.
## Seeing Existing Rules
Before adding our own rules, let's inspect what Linux already has.
Run:
```bash
sudo iptables -L
```
Example output:
```
Chain INPUT (policy ACCEPT)

Chain FORWARD (policy ACCEPT)

Chain OUTPUT (policy ACCEPT)
```
Notice the default policy.
```
ACCEPT
```
Linux currently allows everything.
If your machine is already running Kubernetes, you'll likely see many additional chains.
For example:
```
KUBE-SERVICES

KUBE-FORWARD

KUBE-NODEPORTS
```
If kube-proxy is installed, Kubernetes automatically creates many of these chains.
Since we're building our own networking stack, don't worry too much about them yet.
Instead, focus on understanding the packet flow.
## Watching Packet Counters
One of my favourite debugging tricks is adding the `-v` flag.
```bash
sudo iptables -L -v
```
Example:
```
Chain FORWARD

pkts bytes target

2300 180K ACCEPT
```
Notice the packet counters.
Every time traffic matches a rule, Linux increments those numbers.
This is incredibly useful.
Later, after adding our own rules, we can immediately see whether packets are actually reaching them.
## Following a Packet Through the Node
Suppose we have:
```
Frontend

10.244.1.2

Worker-1
```
communicating with
```
Backend

10.244.2.2

Worker-2
```
The packet takes this path.
```
Frontend Pod

      │

    eth0

      │

   veth pair

      │

     cni0

      │

Worker-1 Routing Table

      │

FORWARD chain

      │

eth1

      │

========== Physical Network ==========

      │

Worker-2 eth1

      │

FORWARD chain

      │

Worker-2 Routing Table

      │

cni0

      │

veth

      │

Backend Pod
```
Notice something.
Before Linux forwards the packet out of Worker-1...
it enters the FORWARD chain.
Likewise, before Worker-2 forwards the packet into the Pod...
it also enters the FORWARD chain.
This means we can block communication simply by dropping packets there.
## Lab 1 — Blocking All Traffic To a Backend Pod
Let's start with the simplest firewall rule possible.
Find one backend Pod.
```bash
kubectl get pods \
    -n backend \
    -o wide
```
Example:
```
NAME

backend-65c8d

IP

10.244.2.2
```
Now SSH into the worker node hosting that Pod.
We'll add a rule.
```bash
sudo iptables \
    -I FORWARD \
    -d 10.244.2.2 \
    -j DROP
```
Let's explain every part.
```
-I
```
Insert the rule at the top.
```
FORWARD
```
Apply it to forwarded traffic.
```
-d
```
Destination address.
```
10.244.2.2
```
The backend Pod.
```
-j DROP
```
Silently discard packets.
Linux won't send an error.
It simply behaves as though the packet never existed.
## Testing the Rule
Return to one of the frontend Pods.
```bash
kubectl exec \
    -it \
    -n frontend \
    "$FRONTEND_POD" \
    -- sh
```
Now try:
```bash
curl http://backend.backend
```
The request should now hang until it eventually times out.
Nothing is wrong with nginx.
Nothing is wrong with Kubernetes.
Linux simply discarded the packet before it reached the Pod.
Congratulations.
You have just manually enforced your first "network policy."
## Inspecting the Rule
Let's verify it exists.
```bash
sudo iptables -L FORWARD -v
```
Example:
```
pkts bytes target

12 720 DROP

destination

10.244.2.2
```
Notice the packet counter.
Each failed request increments that number.
Linux is literally counting every packet it blocks.
Watching these counters while testing policies is one of the easiest ways to debug packet flow.
## Removing the Rule
Once you're finished testing, delete it.
```bash
sudo iptables \
    -D FORWARD \
    -d 10.244.2.2 \
    -j DROP
```
Immediately test again.
```bash
curl http://backend.backend
```
The request succeeds once more.
Nothing changed inside Kubernetes.
We only changed the Linux firewall.
That is an important lesson.
Kubernetes NetworkPolicies do not perform packet filtering.
Linux does.
The policy controller simply programs Linux to enforce the desired behaviour.
In the next lab, we'll move beyond blocking a single Pod IP and begin creating rules that resemble real Kubernetes policies by selectively allowing frontend Pods while denying traffic from every other namespace.
```
```
````markdown
## Lab 2 — Simulating a Default-Deny Network Policy

In the previous lab, we blocked traffic to a single Pod.

That helped us understand how Linux can reject packets.

But Kubernetes NetworkPolicies usually don't target individual Pod IPs.

Instead, they target groups of Pods using labels.

For example:

```yaml
podSelector:
  matchLabels:
    app: backend
````

If our backend Deployment has three replicas, Kubernetes might assign them the following addresses.

```
backend-1
10.244.1.3
```

```
backend-2
10.244.2.2
```

```
backend-3
10.244.2.3
```

A NetworkPolicy selecting `app=backend` really means:

> Apply this policy to all three of these Pods.

Our future Network Policy Controller will eventually discover those IPs automatically.

For now, we'll pretend we're the controller.

We'll manually create the firewall rules ourselves.


## Understanding Default Deny

Suppose our cluster looks like this.

```
Frontend Namespace
Frontend Pods
```

```
Backend Namespace
Backend Pods
```

```
Database Namespace
Database Pods
```

Initially, every namespace can communicate with every other namespace.

```
Frontend ------> Backend
Frontend ------> Database
Backend -------> Database
Database ------> Backend
Database ------> Frontend
```

Now imagine someone creates this policy.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: backend
spec:
  podSelector: {}
  policyTypes:
    - Ingress
```

Notice something.

There are **no ingress rules**.

This means:

> Every Pod inside the backend namespace is now isolated.

Unless another policy explicitly allows traffic, Linux should reject every incoming packet.

Let's simulate exactly that ourselves.


## Finding the Backend Pod IPs

First, list every backend Pod.

```bash
kubectl get pods \
    -n backend \
    -o wide
```

Example:

```text
NAME             IP
backend-1        10.244.1.3
backend-2        10.244.2.2
backend-3        10.244.2.3
```

Suppose:

```
10.244.1.3
```

lives on Worker-1.

The remaining two Pods live on Worker-2.

Remember:

`iptables` rules only affect the machine on which they are installed.

That means:

* Worker-1 must protect Pods running on Worker-1.
* Worker-2 must protect Pods running on Worker-2.

This is one of the biggest reasons Network Policy Controllers are deployed as DaemonSets.

Each node is responsible for enforcing policies on the Pods it hosts.


## Blocking All Incoming Traffic

On Worker-1:

```bash
sudo iptables \
    -I FORWARD \
    -d 10.244.1.3 \
    -j DROP
```

On Worker-2:

```bash
sudo iptables \
    -I FORWARD \
    -d 10.244.2.2 \
    -j DROP
sudo iptables \
    -I FORWARD \
    -d 10.244.2.3 \
    -j DROP
```

Conceptually, Linux now behaves like this.

```
Any Pod
     │
     ▼
FORWARD Chain
     │
Destination:
Backend Pod
     │
DROP
```

Everything trying to reach the backend Pods is discarded.


## Testing Default Deny

Enter one of the frontend Pods.

```bash
kubectl exec \
    -it \
    -n frontend \
    "$FRONTEND_POD" \
    -- sh
```

Try reaching the backend Service.

```bash
curl http://backend.backend
```

The request should eventually time out.

Now enter one of the database Pods.

```bash
kubectl exec \
    -it \
    -n database \
    "$DATABASE_POD" \
    -- sh
```

Try exactly the same request.

```bash
curl http://backend.backend
```

It also fails.

At this point, we've manually recreated the behaviour of a default-deny ingress policy.

No Pod can contact the backend.


## Allowing Only the Frontend

A default-deny policy by itself isn't very useful.

Usually we want something more like this.

```
Frontend
Allowed
↓
Backend
↑
Database
Denied
```

How can Linux distinguish frontend Pods from database Pods?

Remember:

Linux doesn't understand labels.

It only understands IP addresses.

So our future Network Policy Controller must perform a translation.

```
role=frontend
↓
Query Kubernetes
↓
10.244.1.2
10.244.2.4
10.244.2.5
↓
Generate iptables rules
```

Let's simulate that manually.

Suppose our frontend Pods have the following addresses.

```
10.244.1.2
10.244.2.4
10.244.2.5
```

Before the DROP rules, insert ACCEPT rules.

On Worker-1:

```bash
sudo iptables \
    -I FORWARD 1 \
    -s 10.244.1.2 \
    -d 10.244.1.3 \
    -j ACCEPT
```

On Worker-2:

```bash
sudo iptables \
    -I FORWARD 1 \
    -s 10.244.2.4 \
    -d 10.244.2.2 \
    -j ACCEPT
sudo iptables \
    -I FORWARD 1 \
    -s 10.244.2.5 \
    -d 10.244.2.3 \
    -j ACCEPT
```

Notice the number:

```bash
-I FORWARD 1
```

That inserts the ACCEPT rule at the very beginning of the chain.

Rule order matters.

iptables evaluates rules from top to bottom.

As soon as one rule matches, evaluation stops.

If we placed the DROP rule first, Linux would never reach the ACCEPT rule.

Conceptually, the chain now looks like this.

```
FORWARD
↓
Frontend?
↓
Yes
↓
ACCEPT
↓
No
↓
Destination Backend?
↓
DROP
```

This is exactly how firewall rules are typically evaluated.


## Testing Again

Return to the frontend Pod.

```bash
curl http://backend.backend
```

It should now succeed.

Now test from the database Pod.

```bash
curl http://backend.backend
```

This should still fail.

We have manually implemented the following policy.

```
Frontend
Allowed
↓
Backend
Database
Denied
↓
Backend
```

Doesn't that look remarkably similar to this Kubernetes object?

```yaml
kind: NetworkPolicy
podSelector:
  matchLabels:
    app: backend
ingress:
- from:
  - podSelector:
      matchLabels:
        app: frontend
```

The YAML looks much simpler.

But underneath, someone still has to produce firewall rules.

That "someone" is exactly what we'll build next.


## Why This Doesn't Scale

Our manual firewall works.

But imagine a real cluster.

Today the frontend has three Pods.

Tomorrow it scales to ten.

Later it scales back down to two.

Every scale event changes Pod IP addresses.

Every rollout replaces Pods with new ones.

Every node may host different replicas.

Keeping these firewall rules synchronized by hand would be impossible.

Instead, we need software that continuously watches the Kubernetes API.

Whenever:

* a Pod is created
* a Pod is deleted
* labels change
* a NetworkPolicy changes
* a Namespace changes

the firewall rules should automatically update.

That software is exactly what we're going to build in the next article.

Instead of manually writing `iptables` commands, we'll create a **Network Policy Controller** running as a DaemonSet on every node.

It will watch Kubernetes resources, resolve labels into Pod IP addresses, and continuously program the Linux firewall so that the actual packet filtering always matches the desired NetworkPolicy objects stored in Kubernetes.
